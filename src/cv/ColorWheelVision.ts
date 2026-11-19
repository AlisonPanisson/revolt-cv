export interface ColorVisionSnapshot {
  active: boolean;
  detectedBlobs: number;
  steer: number; // -1 (left) .. +1 (right)
  throttle: number; // 0 .. 1
  brake: number; // 0 .. 1
  fireTriggered: boolean;
  wheelAngleDeg: number;
  gestureLabel: string;
}

export type VisionPreset = 'skin_hands' | 'neon_wheel' | 'cyan_markers' | 'yellow_markers';

interface BlobCluster {
  cx: number; // 0..1 mirrored
  cy: number; // 0..1
  area: number; // fraction of frame
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Pure TypeScript/Canvas2D Real-Time Computer Vision Hand & Wheel Tracker.
 * Works with ZERO external WASM/CDN dependencies across any webcam or uploaded video,
 * and supports click-to-sample custom color calibration + two-blob virtual steering wheel
 * + optical motion centroid tracking.
 */
export class ColorWheelVision {
  private procCanvas: HTMLCanvasElement;
  private procCtx: CanvasRenderingContext2D;
  private readonly pw = 120;
  private readonly ph = 90;

  private prevLuma: Float32Array;
  private preset: VisionPreset = 'skin_hands';

  // Custom calibrated target in normalized RGB / HSV
  private customHue: number | null = null;
  private customSat = 0.5;

  private smoothedSteer = 0;
  private smoothedThrottle = 0;
  private smoothedBrake = 0;
  private fireCooldown = 0;

  constructor() {
    this.procCanvas = document.createElement('canvas');
    this.procCanvas.width = this.pw;
    this.procCanvas.height = this.ph;
    const ctx = this.procCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Unable to create CV processing canvas');
    this.procCtx = ctx;
    this.prevLuma = new Float32Array(this.pw * this.ph);
  }

  public setPreset(preset: VisionPreset): void {
    this.preset = preset;
    this.customHue = null;
  }

  public getPreset(): VisionPreset {
    return this.preset;
  }

  /**
   * Sample pixel color from the video at normalized (0..1) mirrored coordinates
   * when the user clicks their hand or steering object in the camera viewport.
   */
  public sampleColorAt(videoEl: HTMLVideoElement, normMirrorX: number, normY: number): string {
    if (videoEl.readyState < 2) return '#ffd000';
    this.procCtx.drawImage(videoEl, 0, 0, this.pw, this.ph);
    // Video is displayed mirrored horizontally (1 - x)
    const rawX = Math.max(0, Math.min(this.pw - 1, Math.floor((1 - normMirrorX) * this.pw)));
    const rawY = Math.max(0, Math.min(this.ph - 1, Math.floor(normY * this.ph)));
    const data = this.procCtx.getImageData(rawX, rawY, 1, 1).data;
    const [h, s] = this.rgbToHsv(data[0], data[1], data[2]);
    this.customHue = h;
    this.customSat = Math.max(0.18, s * 0.65);
    return `rgb(${data[0]}, ${data[1]}, ${data[2]})`;
  }

  private rgbToHsv(r: number, g: number, b: number): [number, number, number] {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const d = max - min;
    let h = 0;
    const s = max === 0 ? 0 : d / max;
    const v = max;

    if (max !== min) {
      switch (max) {
        case rn:
          h = (gn - bn) / d + (gn < bn ? 6 : 0);
          break;
        case gn:
          h = (bn - rn) / d + 2;
          break;
        case bn:
          h = (rn - gn) / d + 4;
          break;
      }
      h /= 6;
    }
    return [h * 360, s, v];
  }

  private matchesTargetPixel(r: number, g: number, b: number, motionDiff: number): boolean {
    const [h, s, v] = this.rgbToHsv(r, g, b);

    if (this.customHue !== null) {
      let hueDiff = Math.abs(h - this.customHue);
      if (hueDiff > 180) hueDiff = 360 - hueDiff;
      return hueDiff < 28 && s >= this.customSat && v > 0.18;
    }

    switch (this.preset) {
      case 'skin_hands': {
        // YCrCb + HSV human skin-tone detector enhanced with subtle motion salience
        const y = 0.299 * r + 0.587 * g + 0.114 * b;
        const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
        const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
        const isSkinYCrCb = y > 55 && cr > 133 && cr < 178 && cb > 76 && cb < 129;
        const isSkinRgb = r > 85 && g > 38 && b > 20 && r > g && r > b && r - Math.min(g, b) > 15;
        return (isSkinYCrCb && isSkinRgb) || motionDiff > 34;
      }
      case 'neon_wheel': {
        // High-saturation bright object (red/orange/pink/green controller or cup)
        return s > 0.52 && v > 0.35 && (h < 35 || h > 325 || (h > 95 && h < 155));
      }
      case 'cyan_markers': {
        return h >= 165 && h <= 225 && s > 0.42 && v > 0.28;
      }
      case 'yellow_markers': {
        return h >= 36 && h <= 74 && s > 0.45 && v > 0.35;
      }
    }
  }

  public processFrame(
    videoEl: HTMLVideoElement,
    overlayCtx: CanvasRenderingContext2D,
    outW: number,
    outH: number,
    sensitivity: number,
    centerOffsetDeg: number,
    autoThrottle: boolean
  ): ColorVisionSnapshot {
    if (this.fireCooldown > 0) this.fireCooldown--;

    this.procCtx.drawImage(videoEl, 0, 0, this.pw, this.ph);
    const frame = this.procCtx.getImageData(0, 0, this.pw, this.ph);
    const data = frame.data;

    // Split left and right mirrored halves to track 2 hands / 2 wheel grips robustly
    let leftCount = 0,
      leftSumX = 0,
      leftSumY = 0;
    let rightCount = 0,
      rightSumX = 0,
      rightSumY = 0;
    let topZoneHits = 0;

    overlayCtx.clearRect(0, 0, outW, outH);

    // Draw subtle CV scan grid
    overlayCtx.strokeStyle = 'rgba(0, 200, 255, 0.12)';
    overlayCtx.lineWidth = 1;
    overlayCtx.beginPath();
    overlayCtx.moveTo(outW * 0.5, 0);
    overlayCtx.lineTo(outW * 0.5, outH);
    overlayCtx.moveTo(0, outH * 0.22);
    overlayCtx.lineTo(outW, outH * 0.22);
    overlayCtx.stroke();

    const scaleX = outW / this.pw;
    const scaleY = outH / this.ph;
    overlayCtx.fillStyle = 'rgba(46, 229, 157, 0.38)';

    for (let y = 2; y < this.ph - 2; y += 2) {
      for (let x = 2; x < this.pw - 2; x += 2) {
        const idx = (y * this.pw + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        const luma = 0.299 * r + 0.587 * g + 0.114 * b;
        const pIdx = y * this.pw + x;
        const motionDiff = Math.abs(luma - this.prevLuma[pIdx]);
        this.prevLuma[pIdx] = luma * 0.65 + this.prevLuma[pIdx] * 0.35;

        if (this.matchesTargetPixel(r, g, b, motionDiff)) {
          // Mirror X so it matches the mirrored selfie video
          const mx = this.pw - 1 - x;
          const normX = mx / this.pw;
          const normY = y / this.ph;

          overlayCtx.fillRect(mx * scaleX, y * scaleY, scaleX * 1.7, scaleY * 1.7);

          if (normY < 0.22) {
            topZoneHits++;
          }

          if (normX < 0.5) {
            leftCount++;
            leftSumX += normX;
            leftSumY += normY;
          } else {
            rightCount++;
            rightSumX += normX;
            rightSumY += normY;
          }
        }
      }
    }

    const blobs: BlobCluster[] = [];
    if (leftCount >= 12) {
      blobs.push({
        cx: leftSumX / leftCount,
        cy: leftSumY / leftCount,
        area: leftCount / (this.pw * this.ph * 0.25),
        minX: 0,
        maxX: 0.5,
        minY: 0,
        maxY: 1,
      });
    }
    if (rightCount >= 12) {
      blobs.push({
        cx: rightSumX / rightCount,
        cy: rightSumY / rightCount,
        area: rightCount / (this.pw * this.ph * 0.25),
        minX: 0.5,
        maxX: 1,
        minY: 0,
        maxY: 1,
      });
    }

    let targetAngleDeg = 0;
    let totalArea = 0;

    if (blobs.length >= 2) {
      const L = blobs[0];
      const R = blobs[1];
      const dx = Math.max(0.08, R.cx - L.cx);
      const dy = R.cy - L.cy;
      targetAngleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
      totalArea = L.area + R.area;

      // Draw tracked hand centroids
      for (const b of [L, R]) {
        overlayCtx.beginPath();
        overlayCtx.arc(b.cx * outW, b.cy * outH, 10, 0, Math.PI * 2);
        overlayCtx.fillStyle = '#ffd000';
        overlayCtx.fill();
        overlayCtx.strokeStyle = '#0b0e14';
        overlayCtx.lineWidth = 2;
        overlayCtx.stroke();
      }
    } else if (blobs.length === 1) {
      const B = blobs[0];
      targetAngleDeg = (B.cx - 0.5) * 85;
      totalArea = B.area * 1.6;

      overlayCtx.beginPath();
      overlayCtx.arc(B.cx * outW, B.cy * outH, 11, 0, Math.PI * 2);
      overlayCtx.fillStyle = '#00c8ff';
      overlayCtx.fill();
    }

    const calibratedDeg = targetAngleDeg - centerOffsetDeg;
    const rawSteer = Math.max(-1, Math.min(1, (calibratedDeg / 36) * sensitivity));
    this.smoothedSteer += (rawSteer - this.smoothedSteer) * 0.32;

    // Raise hands into top 22% trigger zone to fire lightning pickup!
    let fireTriggered = false;
    if (topZoneHits > 22 && this.fireCooldown === 0) {
      fireTriggered = true;
      this.fireCooldown = 28;
    }

    let targetThrottle = 0;
    let targetBrake = 0;
    let label = 'SHOW HANDS / CLICK TO CALIBRATE';

    if (blobs.length === 0) {
      this.smoothedSteer *= 0.85;
      targetThrottle = autoThrottle ? 0.8 : 0;
      label = 'CLICK HAND ON VIDEO TO LOCK COLOR';
    } else if (fireTriggered) {
      targetThrottle = 1;
      label = 'TOP ZONE FIRE!';
    } else if (totalArea < 0.045 && !autoThrottle) {
      // Very small closed fists or pulled back hands -> Brake
      targetBrake = 1;
      label = 'CV BRAKE';
    } else {
      targetThrottle = 1;
      label = blobs.length >= 2 ? '2H CV WHEEL + GAS' : '1H CV TRACK + GAS';
    }

    this.smoothedThrottle += (targetThrottle - this.smoothedThrottle) * 0.3;
    this.smoothedBrake += (targetBrake - this.smoothedBrake) * 0.3;

    return {
      active: true,
      detectedBlobs: blobs.length,
      steer: this.smoothedSteer,
      throttle: this.smoothedThrottle,
      brake: this.smoothedBrake,
      fireTriggered,
      wheelAngleDeg: calibratedDeg,
      gestureLabel: label,
    };
  }
}
