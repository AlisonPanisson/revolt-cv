import * as THREE from 'three';
import type { PickupType } from '../types';
import type { RCVehicle } from '../physics/RCVehicle';
import type { BuiltTrack } from './TrackBuilder';
import type { SoundEngine } from '../audio/SoundEngine';

interface PickupNode {
  pos: THREE.Vector3;
  mesh: THREE.Group;
  respawnTimer: number;
}

interface ActiveRocket {
  ownerId: string;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  mesh: THREE.Group;
  lifeSec: number;
}

interface ActiveOilSlick {
  ownerId: string;
  pos: THREE.Vector3;
  mesh: THREE.Mesh;
  lifeSec: number;
}

interface ActiveShockwave {
  pos: THREE.Vector3;
  mesh: THREE.Mesh;
  ageSec: number;
}

const ALL_PICKUPS: PickupType[] = ['rocket', 'turbo', 'shockwave', 'oil'];

export class PickupManager {
  private scene: THREE.Scene;
  private sound: SoundEngine;
  private nodes: PickupNode[] = [];
  private rockets: ActiveRocket[] = [];
  private oilSlicks: ActiveOilSlick[] = [];
  private shockwaves: ActiveShockwave[] = [];
  private onEventToast: (msg: string) => void;

  constructor(scene: THREE.Scene, sound: SoundEngine, onEventToast: (msg: string) => void) {
    this.scene = scene;
    this.sound = sound;
    this.onEventToast = onEventToast;
  }

  public populateForTrack(track: BuiltTrack): void {
    this.clear();

    for (const t of track.def.pickupTs) {
      const { pos, right } = track.getPointAndForwardAt(t);
      // Spawn two side-by-side lightning pickups like classic Re-Volt item rows
      for (const offset of [-2.8, 2.8]) {
        const p = pos.clone().addScaledVector(right, offset);
        p.y = 1.05;
        const mesh = this.createLightningPickupMesh();
        mesh.position.copy(p);
        this.scene.add(mesh);
        this.nodes.push({ pos: p, mesh, respawnTimer: 0 });
      }
    }
  }

  private createLightningPickupMesh(): THREE.Group {
    const group = new THREE.Group();

    const coreMat = new THREE.MeshStandardMaterial({
      color: 0x00c8ff,
      emissive: 0x00aaff,
      emissiveIntensity: 1.15,
      roughness: 0.15,
      metalness: 0.4,
    });
    const boltMat = new THREE.MeshBasicMaterial({ color: 0xffd000 });

    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.68, 0), coreMat);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.86, 0.055, 8, 24),
      boltMat
    );
    group.add(crystal, ring);
    return group;
  }

  public update(dt: number, racers: RCVehicle[]): void {
    const now = performance.now() * 0.001;

    // 1. Floating lightning pickups & collection check
    for (const node of this.nodes) {
      if (node.respawnTimer > 0) {
        node.respawnTimer = Math.max(0, node.respawnTimer - dt);
        node.mesh.visible = node.respawnTimer === 0;
        continue;
      }

      node.mesh.rotation.y = now * 2.4;
      node.mesh.position.y = node.pos.y + Math.sin(now * 3.5 + node.pos.x) * 0.18;

      for (const car of racers) {
        if (car.heldPickup !== null || car.pickupRouletteTimer > 0) continue;
        const dx = car.chassisBody.position.x - node.pos.x;
        const dz = car.chassisBody.position.z - node.pos.z;
        if (dx * dx + dz * dz < 4.2) {
          node.respawnTimer = 5.0;
          node.mesh.visible = false;
          car.pickupRouletteTimer = 0.75;
          car.heldPickup = ALL_PICKUPS[Math.floor(Math.random() * ALL_PICKUPS.length)];
          if (car.isPlayer) {
            this.sound.playPickupCollect();
          }
          break;
        }
      }
    }

    // 2. Homing Bottle Rockets
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.lifeSec -= dt;

      // Subtle Re-Volt style homing toward nearest rival ahead
      let bestTarget: RCVehicle | null = null;
      let bestDist = 36;
      for (const car of racers) {
        if (car.id === r.ownerId) continue;
        const cPos = new THREE.Vector3(
          car.chassisBody.position.x,
          car.chassisBody.position.y,
          car.chassisBody.position.z
        );
        const dist = cPos.distanceTo(r.pos);
        if (dist < bestDist) {
          bestDist = dist;
          bestTarget = car;
        }
      }

      if (bestTarget) {
        const desired = new THREE.Vector3(
          bestTarget.chassisBody.position.x - r.pos.x,
          0,
          bestTarget.chassisBody.position.z - r.pos.z
        ).normalize();
        const speed = r.vel.length();
        r.vel.lerp(desired.multiplyScalar(speed), Math.min(1, dt * 4.5));
      }

      r.pos.addScaledVector(r.vel, dt);
      r.mesh.position.copy(r.pos);
      r.mesh.lookAt(r.pos.clone().add(r.vel));

      let hit = false;
      for (const car of racers) {
        if (car.id === r.ownerId) continue;
        const dx = car.chassisBody.position.x - r.pos.x;
        const dz = car.chassisBody.position.z - r.pos.z;
        if (dx * dx + dz * dz < 5.5) {
          car.applyBlastHit(13.5);
          this.spawnShockwaveVisual(r.pos, 0xff441f);
          this.sound.playExplosion();
          this.onEventToast(`🚀 Rocket blasted ${car.name}!`);
          hit = true;
          break;
        }
      }

      if (hit || r.lifeSec <= 0) {
        this.scene.remove(r.mesh);
        this.rockets.splice(i, 1);
      }
    }

    // 3. Oil Slick Puddles
    for (let i = this.oilSlicks.length - 1; i >= 0; i--) {
      const oil = this.oilSlicks[i];
      oil.lifeSec -= dt;
      for (const car of racers) {
        if (car.id === oil.ownerId && oil.lifeSec > 11.2) continue;
        const dx = car.chassisBody.position.x - oil.pos.x;
        const dz = car.chassisBody.position.z - oil.pos.z;
        if (dx * dx + dz * dz < 4.5) {
          car.applyOilSpin();
          oil.lifeSec = 0;
          if (car.isPlayer) {
            this.onEventToast('🛢️ Hit Grease Slick!');
          }
          break;
        }
      }
      if (oil.lifeSec <= 0) {
        this.scene.remove(oil.mesh);
        this.oilSlicks.splice(i, 1);
      }
    }

    // 4. Expanding EMP Shockwave Rings
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.ageSec += dt;
      const scale = 1 + sw.ageSec * 28;
      sw.mesh.scale.set(scale, scale, 1);
      const mat = sw.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0, 0.85 - sw.ageSec * 2.1);
      if (sw.ageSec > 0.42) {
        this.scene.remove(sw.mesh);
        this.shockwaves.splice(i, 1);
      }
    }
  }

  public tryFirePickup(car: RCVehicle, racers: RCVehicle[]): boolean {
    if (!car.heldPickup || car.pickupRouletteTimer > 0) return false;

    const item = car.heldPickup;
    car.heldPickup = null;

    const carPos = new THREE.Vector3(
      car.chassisBody.position.x,
      car.chassisBody.position.y,
      car.chassisBody.position.z
    );
    const fwd = car.getForwardVector();

    switch (item) {
      case 'turbo': {
        car.activateTurbo(2.8);
        if (car.isPlayer) {
          this.sound.playTurbo();
          this.onEventToast('⚡ 14.8V LiPo Overvolt Engaged!');
        }
        break;
      }
      case 'rocket': {
        const rocketGroup = new THREE.Group();
        const tube = new THREE.Mesh(
          new THREE.CylinderGeometry(0.14, 0.14, 1.25, 10),
          new THREE.MeshStandardMaterial({ color: 0xff3b1f, emissive: 0xff2200, emissiveIntensity: 0.6 })
        );
        tube.rotation.x = Math.PI / 2;
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(0.2, 0.42, 10),
          new THREE.MeshBasicMaterial({ color: 0xffd000 })
        );
        cone.rotation.x = Math.PI / 2;
        cone.position.z = 0.75;
        rocketGroup.add(tube, cone);

        const spawnPos = carPos.clone().addScaledVector(fwd, 2.2);
        spawnPos.y = 0.75;
        rocketGroup.position.copy(spawnPos);
        this.scene.add(rocketGroup);

        this.rockets.push({
          ownerId: car.id,
          pos: spawnPos,
          vel: fwd.clone().multiplyScalar(54),
          mesh: rocketGroup,
          lifeSec: 3.4,
        });
        if (car.isPlayer) {
          this.sound.playTurbo();
          this.onEventToast('🚀 Bottle Rocket Launched!');
        }
        break;
      }
      case 'shockwave': {
        this.spawnShockwaveVisual(carPos, 0x00c8ff);
        this.sound.playExplosion();
        let zapped = 0;
        for (const other of racers) {
          if (other.id === car.id) continue;
          const dist = new THREE.Vector3(
            other.chassisBody.position.x,
            other.chassisBody.position.y,
            other.chassisBody.position.z
          ).distanceTo(carPos);
          if (dist < 16) {
            other.applyBlastHit(10.5);
            zapped++;
          }
        }
        if (car.isPlayer) {
          this.onEventToast(zapped > 0 ? `💥 EMP Zapped ${zapped} RC Rival(s)!` : '💥 EMP Pulse Fired!');
        }
        break;
      }
      case 'oil': {
        const dropPos = carPos.clone().addScaledVector(fwd, -2.4);
        dropPos.y = 0.06;
        const puddle = new THREE.Mesh(
          new THREE.CircleGeometry(1.85, 20),
          new THREE.MeshStandardMaterial({
            color: 0x0b1512,
            emissive: 0x124030,
            emissiveIntensity: 0.35,
            roughness: 0.08,
            metalness: 0.85,
          })
        );
        puddle.rotation.x = -Math.PI / 2;
        puddle.position.copy(dropPos);
        this.scene.add(puddle);
        this.oilSlicks.push({
          ownerId: car.id,
          pos: dropPos,
          mesh: puddle,
          lifeSec: 12.0,
        });
        if (car.isPlayer) {
          this.sound.playTone(190, 0.2, 'sine', 0.08);
          this.onEventToast('🛢️ Grease Slick Dropped!');
        }
        break;
      }
    }

    return true;
  }

  private spawnShockwaveVisual(pos: THREE.Vector3, hexColor: number): void {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.6, 1.0, 28),
      new THREE.MeshBasicMaterial({
        color: hexColor,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(pos.x, 0.35, pos.z);
    this.scene.add(ring);
    this.shockwaves.push({ pos: pos.clone(), mesh: ring, ageSec: 0 });
  }

  public clear(): void {
    for (const n of this.nodes) this.scene.remove(n.mesh);
    for (const r of this.rockets) this.scene.remove(r.mesh);
    for (const o of this.oilSlicks) this.scene.remove(o.mesh);
    for (const s of this.shockwaves) this.scene.remove(s.mesh);
    this.nodes = [];
    this.rockets = [];
    this.oilSlicks = [];
    this.shockwaves = [];
  }
}
