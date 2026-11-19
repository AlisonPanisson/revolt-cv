import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import type { CarSpec, PickupType } from '../types';

export function buildRCCarVisual(spec: CarSpec): {
  root: THREE.Group;
  wheelMeshes: THREE.Group[];
  antennaTipGroup: THREE.Group;
  brakeLights: THREE.MeshStandardMaterial;
  turboGlow: THREE.Mesh;
} {
  const root = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(spec.bodyColor),
    roughness: 0.26,
    metalness: 0.22,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(spec.accentColor),
    roughness: 0.35,
    metalness: 0.18,
  });
  const chassisDarkMat = new THREE.MeshStandardMaterial({
    color: 0x151921,
    roughness: 0.65,
    metalness: 0.35,
  });
  const canopyMat = new THREE.MeshStandardMaterial({
    color: 0x0b1017,
    roughness: 0.12,
    metalness: 0.75,
  });
  const brakeLights = new THREE.MeshStandardMaterial({
    color: 0x550808,
    emissive: 0xff1e00,
    emissiveIntensity: 0.2,
    roughness: 0.3,
  });

  // Lower carbon tub chassis (car nose points toward -Z)
  const tub = new THREE.Mesh(new THREE.BoxGeometry(1.38, 0.24, 2.75), chassisDarkMat);
  tub.position.set(0, -0.08, 0);
  tub.castShadow = true;
  tub.receiveShadow = true;
  root.add(tub);

  // Front RC bumper skid plate
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.12, 0.42), chassisDarkMat);
  bumper.position.set(0, -0.1, -1.48);
  bumper.rotation.x = -0.22;
  root.add(bumper);

  // Sculpted body shell based on RC class
  if (spec.bodyStyle === 'gt') {
    const lowerShell = new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.32, 2.86), bodyMat);
    lowerShell.position.set(0, 0.1, 0);
    lowerShell.castShadow = true;
    root.add(lowerShell);

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.28, 1.25), canopyMat);
    cabin.position.set(0, 0.34, 0.1);
    root.add(cabin);

    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.34, 2.88), accentMat);
    stripe.position.set(0, 0.11, 0);
    root.add(stripe);
  } else {
    // Wedge buggy / truggy / lab prototype shell
    const mainBody = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.34, 2.2), bodyMat);
    mainBody.position.set(0, 0.14, 0.12);
    mainBody.castShadow = true;
    root.add(mainBody);

    const noseWedge = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.24, 0.95), bodyMat);
    noseWedge.position.set(0, 0.06, -1.02);
    noseWedge.rotation.x = 0.16;
    noseWedge.castShadow = true;
    root.add(noseWedge);

    const sidePodL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 1.4), accentMat);
    sidePodL.position.set(-0.66, 0.08, 0.15);
    const sidePodR = sidePodL.clone();
    sidePodR.position.x = 0.66;
    root.add(sidePodL, sidePodR);

    const cockpit = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.28, 0.96), canopyMat);
    cockpit.position.set(0, 0.38, 0.08);
    cockpit.rotation.x = 0.12;
    root.add(cockpit);

    if (spec.bodyStyle === 'lab_proto') {
      // Stereo vision camera bar mounted on the roof of Volken CV-1
      const camBar = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.12, 0.18), chassisDarkMat);
      camBar.position.set(0, 0.58, -0.15);
      const lensMat = new THREE.MeshStandardMaterial({
        color: 0x00c8ff,
        emissive: 0x00c8ff,
        emissiveIntensity: 0.7,
      });
      const lensL = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 12), lensMat);
      lensL.rotation.x = Math.PI / 2;
      lensL.position.set(-0.22, 0.58, -0.25);
      const lensR = lensL.clone();
      lensR.position.x = 0.22;
      root.add(camBar, lensL, lensR);
    }
  }

  // Exposed RC shock towers & yellow springs
  const springMat = new THREE.MeshStandardMaterial({ color: 0xffd000, roughness: 0.35 });
  for (const zPos of [-0.95, 0.98]) {
    for (const xSign of [-1, 1]) {
      const shock = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.42, 8), springMat);
      shock.position.set(xSign * 0.48, 0.16, zPos);
      shock.rotation.z = xSign * 0.32;
      root.add(shock);
    }
  }

  // High-mount RC rear wing
  const wingGroup = new THREE.Group();
  const strutGeo = new THREE.BoxGeometry(0.08, 0.42, 0.22);
  const strutL = new THREE.Mesh(strutGeo, chassisDarkMat);
  strutL.position.set(-0.42, 0.42, 1.18);
  const strutR = strutL.clone();
  strutR.position.x = 0.42;

  const wingBlade = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.08, 0.44), accentMat);
  wingBlade.position.set(0, 0.62, 1.24);
  wingBlade.rotation.x = 0.2;
  wingBlade.castShadow = true;

  const endplateGeo = new THREE.BoxGeometry(0.05, 0.22, 0.48);
  const plateL = new THREE.Mesh(endplateGeo, bodyMat);
  plateL.position.set(-0.74, 0.64, 1.24);
  const plateR = plateL.clone();
  plateR.position.x = 0.74;

  wingGroup.add(strutL, strutR, wingBlade, plateL, plateR);
  root.add(wingGroup);

  // Headlights & Brake LEDs
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xdff6ff,
    emissiveIntensity: 0.85,
  });
  for (const xSign of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.09, 0.06), headMat);
    hl.position.set(xSign * 0.32, 0.08, -1.46);
    const bl = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.09, 0.06), brakeLights);
    bl.position.set(xSign * 0.42, 0.12, 1.38);
    root.add(hl, bl);
  }

  // Signature Re-Volt flexible springy RC wire antenna
  const antennaPivot = new THREE.Group();
  antennaPivot.position.set(-0.32, 0.34, 0.68);
  const wireMat = new THREE.MeshStandardMaterial({ color: 0xbfc7d1, metalness: 0.8, roughness: 0.2 });
  const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.024, 1.25, 6), wireMat);
  wire.position.set(0, 0.62, 0);
  const tipMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(spec.bodyColor),
    emissive: new THREE.Color(spec.bodyColor),
    emissiveIntensity: 0.9,
  });
  const tipCap = new THREE.Mesh(new THREE.SphereGeometry(0.065, 10, 10), tipMat);
  tipCap.position.set(0, 1.26, 0);
  antennaPivot.add(wire, tipCap);
  root.add(antennaPivot);

  // Turbo plasma aura underneath car
  const turboGlowMat = new THREE.MeshBasicMaterial({
    color: 0x00c8ff,
    transparent: true,
    opacity: 0.0,
    side: THREE.DoubleSide,
  });
  const turboGlow = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.38, 24), turboGlowMat);
  turboGlow.rotation.x = -Math.PI / 2;
  turboGlow.position.set(0, -0.22, 0);
  root.add(turboGlow);

  // Four knobby RC wheels
  const wheelMeshes: THREE.Group[] = [];
  const tireRadius = 0.44 * spec.wheelScale;
  const tireWidth = 0.36 * spec.wheelScale;

  const tireGeo = new THREE.CylinderGeometry(tireRadius, tireRadius, tireWidth, 20);
  tireGeo.rotateZ(Math.PI / 2);
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x16181d, roughness: 0.82 });

  const rimGeo = new THREE.CylinderGeometry(tireRadius * 0.58, tireRadius * 0.58, tireWidth * 1.03, 12);
  rimGeo.rotateZ(Math.PI / 2);
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0xeaeef5,
    metalness: 0.45,
    roughness: 0.3,
  });

  const spokeGeo = new THREE.BoxGeometry(tireWidth * 1.06, tireRadius * 1.02, 0.07);
  const spokeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(spec.accentColor) });

  for (let i = 0; i < 4; i++) {
    const wGroup = new THREE.Group();
    const tire = new THREE.Mesh(tireGeo, tireMat);
    tire.castShadow = true;
    const rim = new THREE.Mesh(rimGeo, rimMat);
    const spoke = new THREE.Mesh(spokeGeo, spokeMat);
    wGroup.add(tire, rim, spoke);
    wheelMeshes.push(wGroup);
  }

  return {
    root,
    wheelMeshes,
    antennaTipGroup: antennaPivot,
    brakeLights,
    turboGlow,
  };
}

export class RCVehicle {
  public readonly id: string;
  public readonly name: string;
  public readonly isPlayer: boolean;
  public readonly spec: CarSpec;

  public readonly chassisBody: CANNON.Body;
  public readonly vehicle: CANNON.RaycastVehicle;
  public readonly rootMesh: THREE.Group;
  public readonly wheelMeshes: THREE.Group[];

  private antennaPivot: THREE.Group;
  private brakeLights: THREE.MeshStandardMaterial;
  private turboGlow: THREE.Mesh;

  public heldPickup: PickupType | null = null;
  public pickupRouletteTimer = 0;

  private turboTimer = 0;
  private spinoutTimer = 0;
  private upsideDownTimer = 0;
  private antennaPitch = 0;
  private antennaRoll = 0;

  // Race tracking
  public lap = 1;
  public splineT = 0;
  public furthestTInLap = 0;
  public passedHalfway = false;
  public finished = false;
  public finishTimeSec: number | null = null;
  public lapStartTimeSec = 0;
  public bestLapSec: number | null = null;

  constructor(
    id: string,
    name: string,
    spec: CarSpec,
    isPlayer: boolean,
    world: CANNON.World,
    scene: THREE.Scene,
    groundMaterial: CANNON.Material
  ) {
    this.id = id;
    this.name = name;
    this.spec = spec;
    this.isPlayer = isPlayer;

    const visual = buildRCCarVisual(spec);
    this.rootMesh = visual.root;
    this.wheelMeshes = visual.wheelMeshes;
    this.antennaPivot = visual.antennaTipGroup;
    this.brakeLights = visual.brakeLights;
    this.turboGlow = visual.turboGlow;

    scene.add(this.rootMesh);
    for (const wm of this.wheelMeshes) {
      scene.add(wm);
    }

    // Low center of mass box prevents unnatural rollover while preserving springy RC bounce
    this.chassisBody = new CANNON.Body({
      mass: spec.massKg,
      material: groundMaterial,
      linearDamping: 0.06,
      angularDamping: 0.42,
    });
    const chassisShape = new CANNON.Box(new CANNON.Vec3(0.76, 0.24, 1.38));
    this.chassisBody.addShape(chassisShape, new CANNON.Vec3(0, 0.06, 0));

    // Verified cannon-es axis setup: +X right, +Y up, -Z forward for positive engineForce
    this.vehicle = new CANNON.RaycastVehicle({
      chassisBody: this.chassisBody,
      indexRightAxis: 0,
      indexUpAxis: 1,
      indexForwardAxis: 2,
    });

    const wheelRadius = 0.44 * spec.wheelScale;
    const wheelOptions = {
      radius: wheelRadius,
      directionLocal: new CANNON.Vec3(0, -1, 0),
      suspensionStiffness: spec.suspensionStiffness,
      suspensionRestLength: 0.34,
      maxSuspensionForce: 100000,
      maxSuspensionTravel: 0.28,
      dampingRelaxation: 3.2,
      dampingCompression: 4.4,
      frictionSlip: spec.frictionSlip,
      rollInfluence: 0.06,
      axleLocal: new CANNON.Vec3(1, 0, 0),
      chassisConnectionPointLocal: new CANNON.Vec3(),
      customSlidingRotationalSpeed: -30,
      useCustomSlidingRotationalSpeed: true,
    };

    const halfTrack = 0.82;
    const frontZ = -1.02;
    const rearZ = 1.04;
    const connY = 0.04;

    // 0: Front-Left, 1: Front-Right, 2: Rear-Left, 3: Rear-Right
    const wheelPoints = [
      new CANNON.Vec3(-halfTrack, connY, frontZ),
      new CANNON.Vec3(halfTrack, connY, frontZ),
      new CANNON.Vec3(-halfTrack, connY, rearZ),
      new CANNON.Vec3(halfTrack, connY, rearZ),
    ];

    for (const pt of wheelPoints) {
      this.vehicle.addWheel({
        ...wheelOptions,
        chassisConnectionPointLocal: pt.clone(),
      });
    }

    this.vehicle.addToWorld(world);
  }

  public spawnAt(pos: THREE.Vector3, forwardDir: THREE.Vector3): void {
    this.chassisBody.position.set(pos.x, pos.y, pos.z);
    this.chassisBody.velocity.set(0, 0, 0);
    this.chassisBody.angularVelocity.set(0, 0, 0);

    // Car mesh & physics forward is -Z; align -Z with forwardDir
    const flatFwd = new THREE.Vector3(forwardDir.x, 0, forwardDir.z).normalize();
    const yaw = Math.atan2(-flatFwd.x, -flatFwd.z);
    this.chassisBody.quaternion.setFromEuler(0, yaw, 0, 'YXZ');

    this.turboTimer = 0;
    this.spinoutTimer = 0;
    this.upsideDownTimer = 0;
    this.syncVisuals(0.016);
  }

  public activateTurbo(durationSec = 2.6): void {
    this.turboTimer = Math.max(this.turboTimer, durationSec);
    const fwd = this.getForwardVector();
    this.chassisBody.velocity.x += fwd.x * 11;
    this.chassisBody.velocity.z += fwd.z * 11;
  }

  public isTurboActive(): boolean {
    return this.turboTimer > 0;
  }

  public applyBlastHit(impulseStrength = 14): void {
    this.spinoutTimer = 1.1;
    this.chassisBody.velocity.y += impulseStrength;
    this.chassisBody.angularVelocity.y += (Math.random() > 0.5 ? 1 : -1) * 7.5;
    this.chassisBody.angularVelocity.x += 2.4;
  }

  public applyOilSpin(): void {
    if (this.spinoutTimer > 0.3) return;
    this.spinoutTimer = 1.25;
    this.chassisBody.angularVelocity.y += (Math.random() > 0.5 ? 1 : -1) * 8.5;
  }

  public getForwardVector(): THREE.Vector3 {
    const q = new THREE.Quaternion(
      this.chassisBody.quaternion.x,
      this.chassisBody.quaternion.y,
      this.chassisBody.quaternion.z,
      this.chassisBody.quaternion.w
    );
    return new THREE.Vector3(0, 0, -1).applyQuaternion(q).normalize();
  }

  public getForwardSpeedMps(): number {
    const fwd = this.getForwardVector();
    const v = this.chassisBody.velocity;
    return fwd.x * v.x + fwd.y * v.y + fwd.z * v.z;
  }

  public stepControls(
    dt: number,
    steerInput: number, // -1 left .. +1 right
    throttleInput: number, // 0 .. 1
    brakeInput: number, // 0 .. 1
    controlsEnabled: boolean
  ): void {
    if (this.turboTimer > 0) {
      this.turboTimer = Math.max(0, this.turboTimer - dt);
    }
    if (this.spinoutTimer > 0) {
      this.spinoutTimer = Math.max(0, this.spinoutTimer - dt);
    }
    if (this.pickupRouletteTimer > 0) {
      this.pickupRouletteTimer = Math.max(0, this.pickupRouletteTimer - dt);
    }

    // Dynamic tire grip (drops during oil slick / EMP spinout)
    const activeSlip = this.spinoutTimer > 0 ? 0.85 : this.spec.frictionSlip;
    for (const w of this.vehicle.wheelInfos) {
      w.frictionSlip = activeSlip;
    }

    const fwdSpeed = this.getForwardSpeedMps();
    const speedRatio = Math.min(1, Math.abs(fwdSpeed) / this.spec.topSpeedMps);

    // Speed-sensitive steering prevents high-speed twitchiness while keeping hairpins nimble
    const steerAttenuation = 1 - speedRatio * 0.36;
    const steerAngle = -steerInput * this.spec.maxSteerRad * steerAttenuation;
    this.vehicle.setSteeringValue(steerAngle, 0);
    this.vehicle.setSteeringValue(steerAngle, 1);

    let engineForce = 0;
    let brakeForce = 0;

    if (!controlsEnabled) {
      brakeForce = 18;
    } else {
      const turboMul = this.turboTimer > 0 ? 1.48 : 1.0;
      const effectiveTopSpeed = this.spec.topSpeedMps * (this.turboTimer > 0 ? 1.32 : 1.0);

      if (brakeInput > 0.15) {
        if (fwdSpeed > 2.2) {
          // Active braking
          brakeForce = brakeInput * 26;
        } else {
          // Reverse gear
          if (fwdSpeed > -14) {
            engineForce = -brakeInput * this.spec.maxEngineForce * 0.65;
          }
        }
      } else if (throttleInput > 0.05) {
        if (fwdSpeed < effectiveTopSpeed) {
          // 4WD RC torque curve
          engineForce = throttleInput * this.spec.maxEngineForce * turboMul;
        }
      } else {
        // Light natural RC motor drag when coasting
        brakeForce = 1.6;
      }
    }

    // 4WD distribution (45% front, 55% rear) for authentic Re-Volt RC buggy traction
    this.vehicle.applyEngineForce(engineForce * 0.45, 0);
    this.vehicle.applyEngineForce(engineForce * 0.45, 1);
    this.vehicle.applyEngineForce(engineForce * 0.55, 2);
    this.vehicle.applyEngineForce(engineForce * 0.55, 3);

    for (let i = 0; i < 4; i++) {
      this.vehicle.setBrake(brakeForce, i);
    }

    // Aerodynamic RC downforce applied directly at COM (note: cannon-es applyForce expects a relative offset, NOT world position!)
    if (this.vehicle.numWheelsOnGround >= 2) {
      const downforce = Math.min(360, Math.abs(fwdSpeed) * 8.5);
      this.chassisBody.force.y -= downforce;
    }

    // Gentle RC suspension anti-roll & self-leveling torque so cars stay planted and never tip sideways
    const q = new THREE.Quaternion(
      this.chassisBody.quaternion.x,
      this.chassisBody.quaternion.y,
      this.chassisBody.quaternion.z,
      this.chassisBody.quaternion.w
    );
    const upVec = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    if (upVec.y > 0.25) {
      // Cross product (upVec x worldUp) gives corrective axis to keep chassis level
      const rightingTorqueScale = this.vehicle.numWheelsOnGround >= 2 ? 180 : 95;
      this.chassisBody.torque.x += upVec.z * rightingTorqueScale;
      this.chassisBody.torque.z += -upVec.x * rightingTorqueScale;
    }

    // Detect inverted roof-slide and auto-right after 1.2s
    if (upVec.y < 0.2) {
      this.upsideDownTimer += dt;
      if (this.upsideDownTimer > 1.2) {
        this.popUpright();
      }
    } else {
      this.upsideDownTimer = 0;
    }

    // Brake light glow
    this.brakeLights.emissiveIntensity = brakeInput > 0.15 ? 2.2 : 0.25;

    // Turbo visual aura
    const glowMat = this.turboGlow.material as THREE.MeshBasicMaterial;
    glowMat.opacity = this.turboTimer > 0 ? 0.55 + Math.sin(performance.now() * 0.025) * 0.2 : 0;

    // Flexible spring antenna whip
    const targetPitch = -0.22 - (engineForce / 1000) * 0.35;
    const targetRoll = steerInput * 0.38;
    this.antennaPitch += (targetPitch - this.antennaPitch) * Math.min(1, dt * 10);
    this.antennaRoll += (targetRoll - this.antennaRoll) * Math.min(1, dt * 10);
    this.antennaPivot.rotation.set(this.antennaPitch, 0, this.antennaRoll);
  }

  public popUpright(): void {
    this.upsideDownTimer = 0;
    const fwd = this.getForwardVector();
    const yaw = Math.atan2(-fwd.x, -fwd.z);
    this.chassisBody.position.y += 1.4;
    this.chassisBody.quaternion.setFromEuler(0, yaw, 0, 'YXZ');
    this.chassisBody.angularVelocity.set(0, 0, 0);
    this.chassisBody.velocity.scale(0.35, this.chassisBody.velocity);
  }

  public syncVisuals(_dt: number): void {
    this.rootMesh.position.set(
      this.chassisBody.position.x,
      this.chassisBody.position.y,
      this.chassisBody.position.z
    );
    this.rootMesh.quaternion.set(
      this.chassisBody.quaternion.x,
      this.chassisBody.quaternion.y,
      this.chassisBody.quaternion.z,
      this.chassisBody.quaternion.w
    );

    for (let i = 0; i < 4; i++) {
      this.vehicle.updateWheelTransform(i);
      const t = this.vehicle.wheelInfos[i].worldTransform;
      this.wheelMeshes[i].position.set(t.position.x, t.position.y, t.position.z);
      this.wheelMeshes[i].quaternion.set(
        t.quaternion.x,
        t.quaternion.y,
        t.quaternion.z,
        t.quaternion.w
      );
    }
  }

  public dispose(world: CANNON.World, scene: THREE.Scene): void {
    this.vehicle.removeFromWorld(world);
    scene.remove(this.rootMesh);
    for (const wm of this.wheelMeshes) {
      scene.remove(wm);
    }
  }
}
