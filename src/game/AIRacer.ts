import * as THREE from 'three';
import type { RCVehicle } from '../physics/RCVehicle';
import type { BuiltTrack } from './TrackBuilder';
import type { PickupManager } from './PickupManager';

export class AIRacer {
  public readonly vehicle: RCVehicle;
  private laneBias: number;
  private skillPace: number;
  private stuckTimer = 0;
  private itemWaitTimer = 0;

  constructor(vehicle: RCVehicle, laneBias: number, skillPace: number) {
    this.vehicle = vehicle;
    this.laneBias = laneBias;
    this.skillPace = skillPace;
  }

  public update(
    dt: number,
    track: BuiltTrack,
    pickups: PickupManager,
    allRacers: RCVehicle[],
    raceActive: boolean
  ): void {
    if (!raceActive) {
      this.vehicle.stepControls(dt, 0, 0, 1, false);
      return;
    }

    const pos = new THREE.Vector3(
      this.vehicle.chassisBody.position.x,
      this.vehicle.chassisBody.position.y,
      this.vehicle.chassisBody.position.z
    );

    const lookaheadT = (this.vehicle.splineT + 0.042) % 1;
    const { pos: targetBase, right } = track.getPointAndForwardAt(lookaheadT);
    const target = targetBase.clone().addScaledVector(right, this.laneBias);

    const toTarget = target.sub(pos).setY(0);
    const desiredDir = toTarget.normalize();
    const fwd = this.vehicle.getForwardVector().setY(0).normalize();
    const rightCar = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();

    // Positive dot with rightCar => target is to our right (+1 steer)
    const crossRight = desiredDir.dot(rightCar);
    const forwardDot = desiredDir.dot(fwd);

    let steer = Math.max(-1, Math.min(1, crossRight * 2.35));
    if (forwardDot < 0) {
      steer = crossRight >= 0 ? 1 : -1;
    }

    const absSteer = Math.abs(steer);
    const cornerThrottle = absSteer > 0.65 ? 0.68 : 0.96;
    const throttle = cornerThrottle * this.skillPace;
    let brake = 0;

    // Stuck recovery against walls
    if (Math.abs(this.vehicle.getForwardSpeedMps()) < 1.8) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 1.8) {
        // Reverse briefly or reset onto spline
        if (this.stuckTimer > 3.1) {
          const resetSpot = track.getPointAndForwardAt(this.vehicle.splineT);
          this.vehicle.spawnAt(
            new THREE.Vector3(resetSpot.pos.x, 1.1, resetSpot.pos.z),
            resetSpot.forward
          );
          this.stuckTimer = 0;
        } else {
          brake = 0.9;
          steer = -steer;
        }
      }
    } else {
      this.stuckTimer = 0;
    }

    this.vehicle.stepControls(dt, steer, brake > 0 ? 0 : throttle, brake, true);

    // Smart AI weapon firing
    if (this.vehicle.heldPickup && this.vehicle.pickupRouletteTimer <= 0) {
      this.itemWaitTimer += dt;
      if (this.itemWaitTimer > 1.4) {
        pickups.tryFirePickup(this.vehicle, allRacers);
        this.itemWaitTimer = 0;
      }
    } else {
      this.itemWaitTimer = 0;
    }
  }
}
