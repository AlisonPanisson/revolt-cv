import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { CAR_CATALOG, TRACK_CATALOG } from '../data/catalog';
import type { CarId, CarSpec, PickupType, RacerProgress, TrackDefinition, TrackId } from '../types';
import { RCVehicle } from '../physics/RCVehicle';
import { BuiltTrack } from './TrackBuilder';
import { PickupManager } from './PickupManager';
import { AIRacer } from './AIRacer';
import type { SoundEngine } from '../audio/SoundEngine';

export type GamePhase = 'lobby' | 'countdown' | 'racing' | 'finished';
export type CameraMode = 'chase' | 'low' | 'hood';

export interface HudTelemetry {
  phase: GamePhase;
  countdownLabel: string;
  lap: number;
  totalLaps: number;
  place: number;
  totalRacers: number;
  raceTimeSec: number;
  currentLapSec: number;
  bestLapSec: number | null;
  speedKmh: number;
  heldPickup: PickupType | null;
  rouletteSpinning: boolean;
  turboActive: boolean;
  standings: RacerProgress[];
}

export class RaceEngine {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private sound: SoundEngine;

  private world: CANNON.World;
  private groundMat: CANNON.Material;
  private wallMat: CANNON.Material;

  private builtTrack: BuiltTrack | null = null;
  private pickupManager: PickupManager;

  private playerCar: RCVehicle | null = null;
  private aiRacers: AIRacer[] = [];
  private allVehicles: RCVehicle[] = [];

  private selectedCarId: CarId = 'rc_bandit';
  private selectedTrackId: TrackId = 'lia_lab';
  private customLabPhotos: string[] = [];

  private phase: GamePhase = 'lobby';
  private cameraMode: CameraMode = 'chase';
  private countdownTimer = 0;
  private lastCountdownInt = 4;
  private raceElapsedSec = 0;
  private lobbyOrbitAngle = 0.55;

  private camCurrentPos = new THREE.Vector3(0, 8, 16);
  private camCurrentLook = new THREE.Vector3(0, 1, 0);

  private onToast: (msg: string) => void;
  private onFinish: (standings: RacerProgress[]) => void;

  constructor(
    canvas: HTMLCanvasElement,
    sound: SoundEngine,
    onToast: (msg: string) => void,
    onFinish: (standings: RacerProgress[]) => void
  ) {
    this.canvas = canvas;
    this.sound = sound;
    this.onToast = onToast;
    this.onFinish = onFinish;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      62,
      window.innerWidth / window.innerHeight,
      0.2,
      550
    );

    // Physics World
    this.world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -22.5, 0),
    });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.groundMat = new CANNON.Material('ground');
    this.wallMat = new CANNON.Material('wall');

    this.world.addContactMaterial(
      new CANNON.ContactMaterial(this.groundMat, this.wallMat, {
        friction: 0.02,
        restitution: 0.35,
      })
    );
    this.world.addContactMaterial(
      new CANNON.ContactMaterial(this.groundMat, this.groundMat, {
        friction: 0.35,
        restitution: 0.15,
      })
    );

    this.setupLighting();
    this.pickupManager = new PickupManager(this.scene, this.sound, this.onToast);

    window.addEventListener('resize', () => this.handleResize());

    this.loadLobbyShowcase();
  }

  private setupLighting(): void {
    const hemi = new THREE.HemisphereLight(0xdff0ff, 0x3b3024, 0.95);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff6e5, 1.65);
    sun.position.set(65, 95, 45);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 260;
    const d = 115;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);
  }

  private handleResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  public getSelectedCarSpec(): CarSpec {
    return CAR_CATALOG.find((c) => c.id === this.selectedCarId) ?? CAR_CATALOG[0];
  }

  public getSelectedTrackDef(): TrackDefinition {
    return TRACK_CATALOG.find((t) => t.id === this.selectedTrackId) ?? TRACK_CATALOG[0];
  }

  public getTrackSampledPoints(): THREE.Vector3[] {
    return this.builtTrack ? this.builtTrack.sampledPoints : [];
  }

  public getVehiclePositionsForMap(): Array<{ x: number; z: number; color: string; isPlayer: boolean }> {
    return this.allVehicles.map((v) => ({
      x: v.chassisBody.position.x,
      z: v.chassisBody.position.z,
      color: v.spec.bodyColor,
      isPlayer: v.isPlayer,
    }));
  }

  public selectCar(carId: CarId): void {
    this.selectedCarId = carId;
    if (this.phase === 'lobby') {
      this.spawnShowcaseCar();
    }
  }

  public selectTrack(trackId: TrackId): void {
    if (this.selectedTrackId === trackId && this.builtTrack) return;
    this.selectedTrackId = trackId;
    if (this.phase === 'lobby') {
      this.loadLobbyShowcase();
    }
  }

  public setCustomLabPhotos(urls: string[]): void {
    this.customLabPhotos = urls;
    if (this.selectedTrackId !== 'robotics_lab') {
      this.selectedTrackId = 'robotics_lab';
      if (this.phase === 'lobby') {
        this.loadLobbyShowcase();
        return;
      }
    }
    if (this.builtTrack) {
      this.builtTrack.applyCustomLabPhotos(urls);
    }
  }

  public cycleCameraMode(): CameraMode {
    const order: CameraMode[] = ['chase', 'low', 'hood'];
    const next = order[(order.indexOf(this.cameraMode) + 1) % order.length];
    this.cameraMode = next;
    return next;
  }

  public getCameraMode(): CameraMode {
    return this.cameraMode;
  }

  private rebuildTrackEnvironment(): void {
    this.clearVehicles();
    this.pickupManager.clear();
    if (this.builtTrack) {
      this.builtTrack.dispose(this.world, this.scene);
      this.builtTrack = null;
    }

    const def = this.getSelectedTrackDef();
    this.scene.background = new THREE.Color(def.skyTop);
    this.scene.fog = new THREE.FogExp2(def.skyBottom, 0.0024);

    this.builtTrack = new BuiltTrack(def, this.world, this.scene, this.groundMat, this.wallMat);
    if (this.customLabPhotos.length > 0) {
      this.builtTrack.applyCustomLabPhotos(this.customLabPhotos);
    }
    this.pickupManager.populateForTrack(this.builtTrack);
  }

  private clearVehicles(): void {
    for (const v of this.allVehicles) {
      v.dispose(this.world, this.scene);
    }
    this.allVehicles = [];
    this.aiRacers = [];
    this.playerCar = null;
  }

  private spawnShowcaseCar(): void {
    this.clearVehicles();
    if (!this.builtTrack) return;

    const spec = this.getSelectedCarSpec();
    const car = new RCVehicle(
      'player',
      `${spec.name} (You)`,
      spec,
      true,
      this.world,
      this.scene,
      this.groundMat
    );
    const startSpot = this.builtTrack.getPointAndForwardAt(0.985);
    car.spawnAt(new THREE.Vector3(startSpot.pos.x, 0.85, startSpot.pos.z), startSpot.forward);
    this.playerCar = car;
    this.allVehicles = [car];
  }

  public loadLobbyShowcase(): void {
    this.phase = 'lobby';
    this.sound.updateMotor(0, 0, false, false);
    this.rebuildTrackEnvironment();
    this.spawnShowcaseCar();
  }

  public startRace(): void {
    this.sound.unlock();
    this.rebuildTrackEnvironment();
    if (!this.builtTrack) return;

    const playerSpec = this.getSelectedCarSpec();
    const rivalSpecs = CAR_CATALOG.filter((c) => c.id !== playerSpec.id);

    const gridSlots = [
      { t: 0.975, lat: -2.5 },
      { t: 0.982, lat: 2.5 },
      { t: 0.962, lat: -2.5 },
      { t: 0.969, lat: 2.5 },
    ];

    // Spawn Player on front-left grid slot
    const pSlot = gridSlots[0];
    const pPose = this.builtTrack.getPointAndForwardAt(pSlot.t);
    const pStart = pPose.pos.clone().addScaledVector(pPose.right, pSlot.lat);
    pStart.y = 0.85;

    this.playerCar = new RCVehicle(
      'player',
      `${playerSpec.name} (You)`,
      playerSpec,
      true,
      this.world,
      this.scene,
      this.groundMat
    );
    this.playerCar.spawnAt(pStart, pPose.forward);
    this.playerCar.splineT = 0;
    this.allVehicles.push(this.playerCar);

    // Spawn 3 AI RC Rivals
    const aiLaneBiases = [-2.1, 2.2, 0.3];
    const aiPaces = [0.92, 0.88, 0.95];

    rivalSpecs.forEach((spec, idx) => {
      const gSlot = gridSlots[idx + 1];
      const pose = this.builtTrack!.getPointAndForwardAt(gSlot.t);
      const pos = pose.pos.clone().addScaledVector(pose.right, gSlot.lat);
      pos.y = 0.85;

      const aiCar = new RCVehicle(
        `ai_${idx}`,
        spec.name,
        spec,
        false,
        this.world,
        this.scene,
        this.groundMat
      );
      aiCar.spawnAt(pos, pose.forward);
      aiCar.splineT = 0;
      this.allVehicles.push(aiCar);
      this.aiRacers.push(new AIRacer(aiCar, aiLaneBiases[idx], aiPaces[idx]));
    });

    // Snap chase camera behind player right away
    const behind = pStart.clone().addScaledVector(pPose.forward, -8.5);
    behind.y = 3.8;
    this.camCurrentPos.copy(behind);
    this.camCurrentLook.copy(pStart);

    this.phase = 'countdown';
    this.countdownTimer = 3.4;
    this.lastCountdownInt = 4;
    this.raceElapsedSec = 0;
  }

  public resetPlayerToTrack(): void {
    if (!this.playerCar || !this.builtTrack) return;
    const t = this.builtTrack.findClosestSplineT(
      new THREE.Vector3(
        this.playerCar.chassisBody.position.x,
        0,
        this.playerCar.chassisBody.position.z
      )
    );
    const spot = this.builtTrack.getPointAndForwardAt(t);
    this.playerCar.spawnAt(new THREE.Vector3(spot.pos.x, 1.15, spot.pos.z), spot.forward);
    this.onToast('🔧 RC Car Repositioned on Track');
  }

  public step(
    dt: number,
    steer: number,
    throttle: number,
    brake: number,
    firePressed: boolean,
    resetPressed: boolean
  ): HudTelemetry {
    const clampedDt = Math.min(0.05, dt);

    if (this.phase === 'lobby') {
      this.world.step(1 / 60, clampedDt, 3);
      if (this.playerCar) {
        this.playerCar.stepControls(clampedDt, steer, 0, 1, false);
        this.playerCar.syncVisuals(clampedDt);
      }
      if (this.builtTrack) {
        this.builtTrack.syncDynamicProps();
      }
      this.updateLobbyCamera(clampedDt);
      this.renderer.render(this.scene, this.camera);
      return this.buildTelemetry('');
    }

    // Countdown handling
    let countdownLabel = '';
    if (this.phase === 'countdown') {
      this.countdownTimer -= clampedDt;
      const ceilVal = Math.ceil(this.countdownTimer);
      if (ceilVal < this.lastCountdownInt && ceilVal >= 1) {
        this.lastCountdownInt = ceilVal;
        this.sound.playCountdownBeep(false);
      }
      if (this.countdownTimer > 0.4) {
        countdownLabel = String(Math.max(1, Math.ceil(this.countdownTimer - 0.4)));
      } else if (this.countdownTimer > 0) {
        if (this.lastCountdownInt !== 0) {
          this.lastCountdownInt = 0;
          this.sound.playCountdownBeep(true);
        }
        countdownLabel = 'GO!';
      } else {
        this.phase = 'racing';
      }
    }

    const controlsActive = this.phase === 'racing';
    if (controlsActive) {
      this.raceElapsedSec += clampedDt;
    }

    if (resetPressed && controlsActive) {
      this.resetPlayerToTrack();
    }

    // Player vehicle step
    if (this.playerCar) {
      if (this.phase === 'finished') {
        // Gentle celebratory cruise after crossing finish
        this.playerCar.stepControls(clampedDt, 0, 0, 0.5, false);
      } else {
        this.playerCar.stepControls(clampedDt, steer, throttle, brake, controlsActive);
      }

      if (firePressed && controlsActive) {
        this.pickupManager.tryFirePickup(this.playerCar, this.allVehicles);
      }
    }

    // AI vehicles step
    if (this.builtTrack) {
      for (const ai of this.aiRacers) {
        ai.update(clampedDt, this.builtTrack, this.pickupManager, this.allVehicles, controlsActive);
      }
    }

    // Step physics world
    this.world.step(1 / 60, clampedDt, 4);

    // Sync visuals & lap progress
    for (const v of this.allVehicles) {
      v.syncVisuals(clampedDt);
      if (this.builtTrack && (this.phase === 'racing' || this.phase === 'finished')) {
        this.updateRacerLapProgress(v, this.builtTrack);
      }
    }

    if (this.builtTrack) {
      this.builtTrack.syncDynamicProps();
    }

    this.pickupManager.update(clampedDt, this.allVehicles);

    // Update motor audio
    if (this.playerCar) {
      this.sound.updateMotor(
        this.playerCar.getForwardSpeedMps(),
        throttle,
        this.playerCar.isTurboActive(),
        this.phase === 'racing'
      );
      this.updateRaceCamera(clampedDt, this.playerCar);
    }

    this.renderer.render(this.scene, this.camera);
    return this.buildTelemetry(countdownLabel);
  }

  private updateRacerLapProgress(car: RCVehicle, track: BuiltTrack): void {
    if (car.finished) return;

    const prevT = car.splineT;
    const rawT = track.findClosestSplineT(
      new THREE.Vector3(car.chassisBody.position.x, 0, car.chassisBody.position.z)
    );
    car.splineT = rawT;

    if (rawT > 0.38 && rawT < 0.68) {
      car.passedHalfway = true;
    }

    // Detect crossing start/finish line forward
    if (prevT > 0.82 && rawT < 0.18 && car.passedHalfway) {
      car.passedHalfway = false;
      const lapDuration = this.raceElapsedSec - car.lapStartTimeSec;
      car.lapStartTimeSec = this.raceElapsedSec;

      if (lapDuration > 4 && (car.bestLapSec === null || lapDuration < car.bestLapSec)) {
        car.bestLapSec = lapDuration;
      }

      if (car.lap >= track.def.laps) {
        car.finished = true;
        car.finishTimeSec = this.raceElapsedSec;
        if (car.isPlayer) {
          this.phase = 'finished';
          this.sound.playPickupCollect();
          this.onFinish(this.computeStandings());
        }
      } else {
        car.lap += 1;
        if (car.isPlayer) {
          this.sound.playTone(740, 0.22, 'triangle', 0.08);
          this.onToast(
            car.lap === track.def.laps ? '🏁 FINAL LAP!' : `⏱️ Lap ${car.lap} / ${track.def.laps}`
          );
        }
      }
    }
  }

  private computeStandings(): RacerProgress[] {
    const totalLaps = this.getSelectedTrackDef().laps;
    const list: RacerProgress[] = this.allVehicles.map((v) => {
      // Starting grid cars near t=0.97 before crossing line should read ~0 progress on lap 1
      const effectiveT = !v.passedHalfway && v.splineT > 0.85 ? v.splineT - 1 : v.splineT;
      const totalProgress = v.finished
        ? totalLaps + 10 - (v.finishTimeSec ?? 999) * 0.001
        : (v.lap - 1) + effectiveT;

      return {
        id: v.id,
        name: v.name,
        color: v.spec.bodyColor,
        isPlayer: v.isPlayer,
        lap: Math.min(totalLaps, v.lap),
        splineT: v.splineT,
        totalProgress,
        finished: v.finished,
        finishTimeSec: v.finishTimeSec,
        bestLapSec: v.bestLapSec,
      };
    });

    list.sort((a, b) => b.totalProgress - a.totalProgress);
    return list;
  }

  private updateLobbyCamera(dt: number): void {
    if (!this.playerCar) return;
    this.lobbyOrbitAngle += dt * 0.38;
    const target = new THREE.Vector3(
      this.playerCar.chassisBody.position.x,
      this.playerCar.chassisBody.position.y + 0.55,
      this.playerCar.chassisBody.position.z
    );
    const radius = 5.4;
    const camPos = new THREE.Vector3(
      target.x + Math.cos(this.lobbyOrbitAngle) * radius,
      target.y + 1.85,
      target.z + Math.sin(this.lobbyOrbitAngle) * radius
    );
    this.camera.position.lerp(camPos, Math.min(1, dt * 6));
    this.camera.lookAt(target);
    if (Math.abs(this.camera.fov - 52) > 0.2) {
      this.camera.fov += (52 - this.camera.fov) * 0.1;
      this.camera.updateProjectionMatrix();
    }
  }

  private updateRaceCamera(dt: number, car: RCVehicle): void {
    const carPos = new THREE.Vector3(
      car.chassisBody.position.x,
      car.chassisBody.position.y,
      car.chassisBody.position.z
    );
    const fwd = car.getForwardVector();

    if (this.cameraMode === 'hood') {
      const hoodPos = carPos.clone().addScaledVector(fwd, 0.35);
      hoodPos.y += 0.85;
      const hoodLook = carPos.clone().addScaledVector(fwd, 14);
      hoodLook.y += 0.5;
      this.camera.position.copy(hoodPos);
      this.camera.lookAt(hoodLook);
    } else {
      const dist = this.cameraMode === 'low' ? 5.2 : 7.6;
      const height = this.cameraMode === 'low' ? 1.95 : 3.35;

      const desiredPos = carPos.clone().addScaledVector(fwd, -dist);
      desiredPos.y += height;

      const desiredLook = carPos.clone().addScaledVector(fwd, 4.2);
      desiredLook.y += 0.65;

      const smooth = Math.min(1, dt * 9.5);
      this.camCurrentPos.lerp(desiredPos, smooth);
      this.camCurrentLook.lerp(desiredLook, smooth * 1.2);

      this.camera.position.copy(this.camCurrentPos);
      this.camera.lookAt(this.camCurrentLook);
    }

    const targetFov = car.isTurboActive() ? 75 : 62;
    if (Math.abs(this.camera.fov - targetFov) > 0.15) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 7);
      this.camera.updateProjectionMatrix();
    }
  }

  private buildTelemetry(countdownLabel: string): HudTelemetry {
    const standings = this.computeStandings();
    const playerIdx = standings.findIndex((s) => s.isPlayer);
    const totalLaps = this.getSelectedTrackDef().laps;
    const pCar = this.playerCar;

    const speedMps = pCar ? Math.abs(pCar.getForwardSpeedMps()) : 0;
    // Scale speed to fun RC scale MPH/KMH readout
    const speedKmh = Math.round(speedMps * 2.4);

    return {
      phase: this.phase,
      countdownLabel,
      lap: pCar ? Math.min(totalLaps, pCar.lap) : 1,
      totalLaps,
      place: playerIdx >= 0 ? playerIdx + 1 : 1,
      totalRacers: Math.max(1, standings.length),
      raceTimeSec: this.raceElapsedSec,
      currentLapSec: pCar ? Math.max(0, this.raceElapsedSec - pCar.lapStartTimeSec) : 0,
      bestLapSec: pCar ? pCar.bestLapSec : null,
      speedKmh,
      heldPickup: pCar ? pCar.heldPickup : null,
      rouletteSpinning: pCar ? pCar.pickupRouletteTimer > 0 : false,
      turboActive: pCar ? pCar.isTurboActive() : false,
      standings,
    };
  }
}
