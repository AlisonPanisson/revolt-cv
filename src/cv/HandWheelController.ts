import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { ColorWheelVision } from './ColorWheelVision';
import type { VisionPreset } from './ColorWheelVision';

export type CVAlgorithm = 'hybrid' | 'color_cv' | 'mediapipe';

export interface CameraDeviceOption {
  deviceId: string;
  label: string;
}

export interface CVWheelSnapshot {
  active: boolean;
  simMode: boolean;
  detectedHands: number;
  steer: number; // -1 (left) .. +1 (right)
  throttle: number; // 0 .. 1
  brake: number; // 0 .. 1
  fireTriggered: boolean; // edge-triggered pulse
  wheelAngleDeg: number;
  gestureLabel: string;
  algorithm: CVAlgorithm;
}

const HAND_CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

export class HandWheelController {
  private videoEl: HTMLVideoElement;
  private canvasEl: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private landmarker: HandLandmarker | null = null;
  private colorVision: ColorWheelVision;
  private stream: MediaStream | null = null;

  private runningWebcam = false;
  private runningUploadedVideo = false;
  private simMode = false;
  private loading = false;
  private selectedDeviceId = '';
  private algorithm: CVAlgorithm = 'hybrid';

  private sensitivity = 1.25;
  private centerOffsetDeg = 0;
  private autoThrottle = false;

  private rawWheelAngleDeg = 0;
  private smoothedSteer = 0;
  private smoothedThrottle = 0;
  private smoothedBrake = 0;
  private detectedHands = 0;
  private gestureLabel = 'STANDBY';

  private pinchLatched = false;
  private pendingFirePulse = false;
  private lastFireTimeMs = 0;
  private lastVideoTime = -1;

  // Interactive Virtual Hand-Wheel Simulator state
  private simSteerTarget = 0;
  private simDragging = false;
  private simGesture: 'throttle' | 'brake' | 'pinch' | 'coast' = 'throttle';

  constructor(videoEl: HTMLVideoElement, canvasEl: HTMLCanvasElement) {
    this.videoEl = videoEl;
    this.canvasEl = canvasEl;
    const context = canvasEl.getContext('2d');
    if (!context) {
      throw new Error('Could not initialize 2D context for CV overlay');
    }
    this.ctx = context;
    this.colorVision = new ColorWheelVision();
    this.bindInteractiveEvents();
  }

  public isActive(): boolean {
    return this.runningWebcam || this.runningUploadedVideo || this.simMode;
  }

  public isWebcamRunning(): boolean {
    return this.runningWebcam || this.runningUploadedVideo;
  }

  public isSimRunning(): boolean {
    return this.simMode;
  }

  public isLoading(): boolean {
    return this.loading;
  }

  public setAlgorithm(algo: CVAlgorithm): void {
    this.algorithm = algo;
  }

  public getAlgorithm(): CVAlgorithm {
    return this.algorithm;
  }

  public setColorPreset(preset: VisionPreset): void {
    this.colorVision.setPreset(preset);
  }

  public setSelectedDeviceId(deviceId: string): void {
    this.selectedDeviceId = deviceId;
  }

  public setSensitivity(val: number): void {
    this.sensitivity = Math.max(0.5, Math.min(2.5, val));
  }

  public setAutoThrottle(enabled: boolean): void {
    this.autoThrottle = enabled;
  }

  public calibrateCenter(): void {
    this.centerOffsetDeg = this.rawWheelAngleDeg;
  }

  public async listVideoDevices(): Promise<CameraDeviceOption[]> {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      return [];
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter((d) => d.kind === 'videoinput')
        .map((d, idx) => ({
          deviceId: d.deviceId,
          label: d.label || `Laptop Camera ${idx + 1}`,
        }));
    } catch {
      return [];
    }
  }

  private async ensureLandmarker(): Promise<void> {
    if (this.landmarker) return;
    const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
    try {
      this.landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: '/mediapipe/hand_landmarker.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.45,
        minHandPresenceConfidence: 0.45,
        minTrackingConfidence: 0.45,
      });
    } catch {
      this.landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: '/mediapipe/hand_landmarker.task',
          delegate: 'CPU',
        },
        runningMode: 'VIDEO',
        numHands: 2,
      });
    }
  }

  public async startWebcam(deviceIdOverride?: string): Promise<{
    ok: boolean;
    error?: string;
    blockedByIframe?: boolean;
  }> {
    if (this.loading) return { ok: false, error: 'Already initializing camera' };
    this.loading = true;
    this.simMode = false;
    this.runningUploadedVideo = false;

    if (deviceIdOverride !== undefined) {
      this.selectedDeviceId = deviceIdOverride;
    }

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        const inIframe = window.self !== window.top;
        throw new Error(
          inIframe
            ? 'Embedded preview iframe blocked navigator.mediaDevices. Click "Pop Out Camera Tab"!'
            : 'Browser camera API unavailable'
        );
      }

      this.stopWebcamStreamOnly();

      const constraintsList: MediaStreamConstraints[] = [];
      if (this.selectedDeviceId) {
        constraintsList.push({
          video: {
            deviceId: { exact: this.selectedDeviceId },
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
          audio: false,
        });
      }
      constraintsList.push(
        {
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: 'user',
          },
          audio: false,
        },
        { video: true, audio: false }
      );

      let lastErr: unknown = null;
      for (const c of constraintsList) {
        try {
          this.stream = await navigator.mediaDevices.getUserMedia(c);
          break;
        } catch (e) {
          lastErr = e;
        }
      }

      if (!this.stream) {
        throw lastErr ?? new Error('Could not open laptop webcam stream');
      }

      this.videoEl.pause();
      this.videoEl.removeAttribute('src');
      this.videoEl.srcObject = this.stream;
      this.videoEl.muted = true;
      this.videoEl.setAttribute('playsinline', 'true');

      if (this.videoEl.readyState < 1) {
        await new Promise<void>((resolve) => {
          const onReady = () => {
            this.videoEl.removeEventListener('loadedmetadata', onReady);
            resolve();
          };
          this.videoEl.addEventListener('loadedmetadata', onReady);
          window.setTimeout(onReady, 1500);
        });
      }

      await this.videoEl.play();

      this.runningWebcam = true;
      this.gestureLabel = 'CAMERA LIVE';
      this.loading = false;

      // Load MediaPipe Hands in the background while pure-Canvas Color CV works immediately
      void this.ensureLandmarker().catch(() => {
        // Pure-Canvas Color CV remains active even if WebGL/WASM landmarker fails
      });

      return { ok: true };
    } catch (err) {
      this.loading = false;
      this.runningWebcam = false;
      const inIframe = window.self !== window.top;
      const msg = err instanceof Error ? err.message : 'Camera permission denied';
      return {
        ok: false,
        error: msg,
        blockedByIframe: inIframe,
      };
    }
  }

  /**
   * Run live Computer Vision tracking on an uploaded/recorded hand-gesture video clip
   * (useful inside sandboxed iframes or for testing CV pipelines without a physical webcam).
   */
  public async startVideoFile(file: File): Promise<{ ok: boolean; error?: string }> {
    this.stopWebcamStreamOnly();
    this.simMode = false;
    this.runningWebcam = false;

    try {
      const url = URL.createObjectURL(file);
      this.videoEl.srcObject = null;
      this.videoEl.src = url;
      this.videoEl.loop = true;
      this.videoEl.muted = true;
      this.videoEl.setAttribute('playsinline', 'true');
      await this.videoEl.play();
      this.runningUploadedVideo = true;
      this.gestureLabel = 'VIDEO CV LIVE';
      void this.ensureLandmarker().catch(() => {});
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not play uploaded video';
      return { ok: false, error: msg };
    }
  }

  public startSimulator(): void {
    this.stopWebcamStreamOnly();
    this.runningUploadedVideo = false;
    this.simMode = true;
    this.detectedHands = 2;
    this.gestureLabel = 'DRAG WHEEL / MOVE MOUSE';
  }

  public stopAll(): void {
    this.stopWebcamStreamOnly();
    this.runningUploadedVideo = false;
    this.simMode = false;
    this.detectedHands = 0;
    this.smoothedSteer = 0;
    this.smoothedThrottle = 0;
    this.smoothedBrake = 0;
    this.gestureLabel = 'OFF';
    this.ctx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height);
  }

  private stopWebcamStreamOnly(): void {
    this.runningWebcam = false;
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.videoEl.srcObject = null;
  }

  private bindInteractiveEvents(): void {
    const parent = this.canvasEl.parentElement;
    if (!parent) return;

    parent.addEventListener('pointerdown', (e) => {
      const rect = parent.getBoundingClientRect();
      const normX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const normY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

      // If live webcam/video is active, clicking the video samples that hand/marker color for Color CV!
      if (this.runningWebcam || this.runningUploadedVideo) {
        this.colorVision.sampleColorAt(this.videoEl, normX, normY);
        this.gestureLabel = 'COLOR LOCKED!';
        return;
      }

      if (!this.simMode) return;
      this.simDragging = true;
      if (e.button === 2) {
        this.simGesture = 'brake';
      } else {
        const dx = normX - 0.5;
        const dy = normY - 0.52;
        if (Math.hypot(dx, dy) < 0.14) {
          // Clicking center hub fires weapon pickup
          this.simGesture = 'pinch';
          this.triggerFireEdge();
          window.setTimeout(() => {
            if (this.simMode && this.simGesture === 'pinch') {
              this.simGesture = 'throttle';
            }
          }, 260);
        } else {
          this.simSteerTarget = Math.max(-1, Math.min(1, dx * 2.4));
        }
      }
    });

    parent.addEventListener('pointermove', (e) => {
      if (!this.simMode) return;
      const rect = parent.getBoundingClientRect();
      const normX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.simSteerTarget = Math.max(-1, Math.min(1, normX * 1.25));
    });

    window.addEventListener('pointerup', () => {
      this.simDragging = false;
      if (this.simMode && this.simGesture === 'brake') {
        this.simGesture = 'throttle';
      }
    });

    parent.addEventListener('contextmenu', (e) => {
      if (this.simMode) e.preventDefault();
    });
  }

  private triggerFireEdge(): void {
    const now = performance.now();
    if (now - this.lastFireTimeMs > 450) {
      this.pendingFirePulse = true;
      this.lastFireTimeMs = now;
    }
  }

  public update(): CVWheelSnapshot {
    this.syncCanvasSize();
    const w = this.canvasEl.width;
    const h = this.canvasEl.height;

    const videoReady =
      (this.runningWebcam || this.runningUploadedVideo) &&
      this.videoEl.readyState >= 2 &&
      this.videoEl.videoWidth > 0 &&
      this.videoEl.videoHeight > 0;

    if (videoReady) {
      let handledByMediaPipe = false;

      if (
        (this.algorithm === 'mediapipe' || this.algorithm === 'hybrid') &&
        this.landmarker
      ) {
        try {
          const ts = Math.max(this.lastVideoTime + 1, Math.floor(performance.now()));
          this.lastVideoTime = ts;
          const result = this.landmarker.detectForVideo(this.videoEl, ts);
          if (result.landmarks && result.landmarks.length > 0) {
            this.processLandmarks(result.landmarks);
            handledByMediaPipe = true;
          } else if (this.algorithm === 'mediapipe') {
            this.processLandmarks([]);
            handledByMediaPipe = true;
          }
        } catch {
          // Fall back seamlessly to pure-Canvas Color/Skin CV if MediaPipe frame throws
          handledByMediaPipe = false;
        }
      }

      // Pure-Canvas Color & Skin-Motion CV (runs immediately or as Hybrid fallback)
      if (!handledByMediaPipe) {
        const snap = this.colorVision.processFrame(
          this.videoEl,
          this.ctx,
          w,
          h,
          this.sensitivity,
          this.centerOffsetDeg,
          this.autoThrottle
        );
        this.detectedHands = snap.detectedBlobs;
        this.smoothedSteer = snap.steer;
        this.smoothedThrottle = snap.throttle;
        this.smoothedBrake = snap.brake;
        this.rawWheelAngleDeg = snap.wheelAngleDeg + this.centerOffsetDeg;
        this.gestureLabel = snap.gestureLabel;
        if (snap.fireTriggered) {
          this.triggerFireEdge();
        }
        this.drawWheelHud(
          w * 0.5,
          h * 0.54,
          Math.min(w, h) * 0.28,
          snap.wheelAngleDeg,
          snap.detectedBlobs > 0
        );
      }
    } else if (this.simMode) {
      this.processSimulator();
    }

    const fireTriggered = this.pendingFirePulse;
    this.pendingFirePulse = false;

    return {
      active: this.runningWebcam || this.runningUploadedVideo || this.simMode,
      simMode: this.simMode,
      detectedHands: this.detectedHands,
      steer: this.smoothedSteer,
      throttle: this.smoothedThrottle,
      brake: this.smoothedBrake,
      fireTriggered,
      wheelAngleDeg: this.rawWheelAngleDeg - this.centerOffsetDeg,
      gestureLabel: this.gestureLabel,
      algorithm: this.algorithm,
    };
  }

  private syncCanvasSize(): void {
    const w = this.canvasEl.clientWidth || 284;
    const h = this.canvasEl.clientHeight || 213;
    if (this.canvasEl.width !== w || this.canvasEl.height !== h) {
      this.canvasEl.width = w;
      this.canvasEl.height = h;
    }
  }

  private analyzeSingleHand(lm: NormalizedLandmark[]): {
    mirrorWristX: number;
    mirrorWristY: number;
    mirrorCenterX: number;
    mirrorCenterY: number;
    extendedFingers: number;
    pinching: boolean;
    tiltDeg: number;
  } {
    const wrist = lm[0];
    const mcp9 = lm[9];
    const palmScale = Math.max(0.04, Math.hypot(mcp9.x - wrist.x, mcp9.y - wrist.y));

    const fingerPairs: Array<[number, number]> = [
      [8, 6],
      [12, 10],
      [16, 14],
      [20, 18],
    ];
    let extendedFingers = 0;
    for (const [tipIdx, pipIdx] of fingerPairs) {
      const tipDist = Math.hypot(lm[tipIdx].x - wrist.x, lm[tipIdx].y - wrist.y);
      const pipDist = Math.hypot(lm[pipIdx].x - wrist.x, lm[pipIdx].y - wrist.y);
      if (tipDist > pipDist * 1.12) {
        extendedFingers++;
      }
    }

    const thumbIndexDist = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y) / palmScale;
    const pinching = thumbIndexDist < 0.42 && extendedFingers >= 2;

    const mirrorWristX = 1 - wrist.x;
    const mirrorWristY = wrist.y;
    const mirrorMcpX = 1 - mcp9.x;
    const mirrorMcpY = mcp9.y;

    const upX = mirrorMcpX - mirrorWristX;
    const upY = mirrorWristY - mirrorMcpY;
    const tiltDeg = (Math.atan2(upX, Math.max(0.05, upY)) * 180) / Math.PI;

    return {
      mirrorWristX,
      mirrorWristY,
      mirrorCenterX: (mirrorWristX + mirrorMcpX) * 0.5,
      mirrorCenterY: (mirrorWristY + mirrorMcpY) * 0.5,
      extendedFingers,
      pinching,
      tiltDeg,
    };
  }

  private processLandmarks(hands: NormalizedLandmark[][]): void {
    const w = this.canvasEl.width;
    const h = this.canvasEl.height;
    this.ctx.clearRect(0, 0, w, h);

    this.detectedHands = hands.length;
    if (hands.length === 0) {
      this.smoothedSteer *= 0.85;
      this.smoothedThrottle *= 0.85;
      this.smoothedBrake *= 0.85;
      this.pinchLatched = false;
      this.gestureLabel = 'SHOW HANDS TO CAM';
      this.drawWheelHud(w * 0.5, h * 0.52, Math.min(w, h) * 0.28, 0, false);
      return;
    }

    const analyzed = hands
      .map((lm) => ({ lm, info: this.analyzeSingleHand(lm) }))
      .sort((a, b) => a.info.mirrorCenterX - b.info.mirrorCenterX);

    let targetAngleDeg = 0;
    let wheelCenterX = w * 0.5;
    let wheelCenterY = h * 0.52;
    let wheelRadius = Math.min(w, h) * 0.28;

    if (analyzed.length >= 2) {
      const left = analyzed[0].info;
      const right = analyzed[analyzed.length - 1].info;
      const dx = Math.max(0.06, right.mirrorCenterX - left.mirrorCenterX);
      const dy = right.mirrorCenterY - left.mirrorCenterY;
      targetAngleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;

      wheelCenterX = (left.mirrorCenterX + right.mirrorCenterX) * 0.5 * w;
      wheelCenterY = (left.mirrorCenterY + right.mirrorCenterY) * 0.5 * h;
      wheelRadius = Math.max(36, Math.min(92, Math.hypot(dx * w, dy * h) * 0.5));
    } else {
      const single = analyzed[0].info;
      const posAngle = (single.mirrorCenterX - 0.5) * 75;
      targetAngleDeg = single.tiltDeg * 0.65 + posAngle * 0.45;
      wheelCenterX = single.mirrorCenterX * w;
      wheelCenterY = single.mirrorCenterY * h;
      wheelRadius = 46;
    }

    this.rawWheelAngleDeg = targetAngleDeg;
    const calibratedDeg = targetAngleDeg - this.centerOffsetDeg;
    const deadzoneDeg = 3.2;
    const effectiveDeg =
      Math.abs(calibratedDeg) < deadzoneDeg
        ? 0
        : calibratedDeg - Math.sign(calibratedDeg) * deadzoneDeg;

    const rawSteer = Math.max(-1, Math.min(1, (effectiveDeg / 38) * this.sensitivity));
    this.smoothedSteer += (rawSteer - this.smoothedSteer) * 0.34;

    const anyPinching = analyzed.some((a) => a.info.pinching);
    if (anyPinching && !this.pinchLatched) {
      this.pinchLatched = true;
      this.triggerFireEdge();
    } else if (!anyPinching) {
      this.pinchLatched = false;
    }

    const maxExtended = Math.max(...analyzed.map((a) => a.info.extendedFingers));
    const allFists = analyzed.every((a) => a.info.extendedFingers <= 1 && !a.info.pinching);

    let targetThrottle = 0;
    let targetBrake = 0;

    if (allFists) {
      targetBrake = 1;
      targetThrottle = 0;
      this.gestureLabel = 'BRAKE / REV';
    } else if (anyPinching) {
      targetThrottle = this.autoThrottle || maxExtended >= 2 ? 1 : 0.6;
      this.gestureLabel = 'FIRE PICKUP!';
    } else if (maxExtended >= 3 || this.autoThrottle) {
      targetThrottle = 1;
      this.gestureLabel = analyzed.length >= 2 ? '2H WHEEL + GAS' : '1H STEER + GAS';
    } else {
      targetThrottle = 0;
      this.gestureLabel = 'COASTING';
    }

    this.smoothedThrottle += (targetThrottle - this.smoothedThrottle) * 0.35;
    this.smoothedBrake += (targetBrake - this.smoothedBrake) * 0.35;

    for (const { lm, info } of analyzed) {
      this.drawHandSkeleton(lm, info.pinching, allFists);
    }

    this.drawWheelHud(wheelCenterX, wheelCenterY, wheelRadius, calibratedDeg, true);
  }

  private processSimulator(): void {
    const w = this.canvasEl.width;
    const h = this.canvasEl.height;
    this.ctx.clearRect(0, 0, w, h);

    if (!this.simDragging && Math.abs(this.simSteerTarget) < 0.05) {
      this.simSteerTarget *= 0.95;
    }

    this.smoothedSteer += (this.simSteerTarget - this.smoothedSteer) * 0.25;
    this.rawWheelAngleDeg = this.smoothedSteer * 38;

    const targetThrottle = this.simGesture === 'brake' ? 0 : 1;
    const targetBrake = this.simGesture === 'brake' ? 1 : 0;
    this.smoothedThrottle += (targetThrottle - this.smoothedThrottle) * 0.3;
    this.smoothedBrake += (targetBrake - this.smoothedBrake) * 0.3;

    if (this.simGesture === 'pinch') {
      this.gestureLabel = 'SIM FIRE!';
    } else if (this.simGesture === 'brake') {
      this.gestureLabel = 'SIM BRAKE (R-CLICK)';
    } else {
      this.gestureLabel = 'MOVE MOUSE ON WHEEL';
    }

    this.ctx.fillStyle = '#0c1118';
    this.ctx.fillRect(0, 0, w, h);

    const cx = w * 0.5;
    const cy = h * 0.52;
    const rad = Math.min(w, h) * 0.3;
    this.drawWheelHud(cx, cy, rad, this.rawWheelAngleDeg, true);

    // Center FIRE button indicator inside the virtual wheel
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, 18, 0, Math.PI * 2);
    this.ctx.fillStyle =
      this.simGesture === 'pinch' ? '#00c8ff' : 'rgba(255, 208, 0, 0.22)';
    this.ctx.fill();
    this.ctx.font = '700 9px "JetBrains Mono", monospace';
    this.ctx.fillStyle = '#ffffff';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText('FIRE', cx, cy);

    const ang = (this.rawWheelAngleDeg * Math.PI) / 180;
    const lx = cx - Math.cos(ang) * rad;
    const ly = cy - Math.sin(ang) * rad;
    const rx = cx + Math.cos(ang) * rad;
    const ry = cy + Math.sin(ang) * rad;

    for (const [gx, gy] of [
      [lx, ly],
      [rx, ry],
    ]) {
      this.ctx.beginPath();
      this.ctx.arc(gx, gy, 9, 0, Math.PI * 2);
      this.ctx.fillStyle = this.simGesture === 'pinch' ? '#00c8ff' : '#ffd000';
      this.ctx.fill();
    }
  }

  private drawHandSkeleton(lm: NormalizedLandmark[], pinching: boolean, fist: boolean): void {
    const w = this.canvasEl.width;
    const h = this.canvasEl.height;

    this.ctx.strokeStyle = pinching ? '#00c8ff' : fist ? '#ff441f' : '#2ee59d';
    this.ctx.lineWidth = 2;

    for (const [i, j] of HAND_CONNECTIONS) {
      const ax = (1 - lm[i].x) * w;
      const ay = lm[i].y * h;
      const bx = (1 - lm[j].x) * w;
      const by = lm[j].y * h;
      this.ctx.beginPath();
      this.ctx.moveTo(ax, ay);
      this.ctx.lineTo(bx, by);
      this.ctx.stroke();
    }

    for (let idx = 0; idx < lm.length; idx++) {
      const px = (1 - lm[idx].x) * w;
      const py = lm[idx].y * h;
      this.ctx.beginPath();
      this.ctx.arc(px, py, idx === 4 || idx === 8 ? 4 : 2.5, 0, Math.PI * 2);
      this.ctx.fillStyle = idx === 4 || idx === 8 ? '#ffd000' : '#ffffff';
      this.ctx.fill();
    }
  }

  private drawWheelHud(
    cx: number,
    cy: number,
    radius: number,
    angleDeg: number,
    engaged: boolean
  ): void {
    const rad = (angleDeg * Math.PI) / 180;
    this.ctx.save();
    this.ctx.translate(cx, cy);
    this.ctx.rotate(rad);

    this.ctx.beginPath();
    this.ctx.arc(0, 0, radius, 0, Math.PI * 2);
    this.ctx.strokeStyle = engaged ? 'rgba(255, 208, 0, 0.92)' : 'rgba(255, 255, 255, 0.25)';
    this.ctx.lineWidth = 4;
    this.ctx.stroke();

    this.ctx.beginPath();
    this.ctx.moveTo(-radius, 0);
    this.ctx.lineTo(radius, 0);
    this.ctx.moveTo(0, 0);
    this.ctx.lineTo(0, radius);
    this.ctx.strokeStyle = engaged ? 'rgba(255, 208, 0, 0.55)' : 'rgba(255, 255, 255, 0.16)';
    this.ctx.lineWidth = 3;
    this.ctx.stroke();

    this.ctx.beginPath();
    this.ctx.arc(0, -radius, 5, 0, Math.PI * 2);
    this.ctx.fillStyle = '#ff441f';
    this.ctx.fill();

    this.ctx.restore();

    this.ctx.font = '700 11px "JetBrains Mono", monospace';
    this.ctx.fillStyle = '#f5f7fa';
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'alphabetic';
    const dir = Math.abs(angleDeg) < 3 ? 'CTR' : angleDeg > 0 ? 'R' : 'L';
    this.ctx.fillText(`${Math.round(Math.abs(angleDeg))}° ${dir}`, 8, 16);
  }
}
