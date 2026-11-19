import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import type { TrackDefinition } from '../types';

interface DynamicProp {
  body: CANNON.Body;
  mesh: THREE.Object3D;
}

export class BuiltTrack {
  public readonly def: TrackDefinition;
  public readonly curve: THREE.CatmullRomCurve3;
  public readonly sampledPoints: THREE.Vector3[];
  public readonly group = new THREE.Group();
  public readonly bodies: CANNON.Body[] = [];
  public readonly dynamicProps: DynamicProp[] = [];
  private labPhotoMeshes: THREE.Mesh[] = [];

  constructor(
    def: TrackDefinition,
    world: CANNON.World,
    scene: THREE.Scene,
    groundMat: CANNON.Material,
    wallMat: CANNON.Material
  ) {
    this.def = def;
    const pts = def.waypoints.map((p) => new THREE.Vector3(p.x, p.y, p.z));
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.45);
    this.sampledPoints = this.curve.getSpacedPoints(280);

    this.buildFloor(world, groundMat);
    this.buildRoadRibbonAndWalls(world, wallMat);
    this.buildStartGantry();
    this.buildRamps(world, groundMat);
    this.buildCones(world);

    if (def.theme === 'lia_lab') {
      this.buildLiaLabProps();
    } else if (def.theme === 'toy_room') {
      this.buildToyRoomProps();
    } else {
      this.buildRoboticsLabProps();
    }

    scene.add(this.group);
  }

  public getPointAndForwardAt(t: number): { pos: THREE.Vector3; forward: THREE.Vector3; right: THREE.Vector3 } {
    const wrapped = ((t % 1) + 1) % 1;
    const pos = this.curve.getPointAt(wrapped);
    const forward = this.curve.getTangentAt(wrapped).setY(0).normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    return { pos, forward, right };
  }

  public findClosestSplineT(worldPos: THREE.Vector3): number {
    let bestIdx = 0;
    let bestDistSq = Infinity;
    const n = this.sampledPoints.length;
    for (let i = 0; i < n; i++) {
      const p = this.sampledPoints[i];
      const dx = worldPos.x - p.x;
      const dz = worldPos.z - p.z;
      const dSq = dx * dx + dz * dz;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestIdx = i;
      }
    }
    return bestIdx / n;
  }

  public applyCustomLabPhotos(dataUrls: string[]): void {
    if (this.labPhotoMeshes.length === 0 || dataUrls.length === 0) return;
    const loader = new THREE.TextureLoader();
    this.labPhotoMeshes.forEach((mesh, idx) => {
      const url = dataUrls[idx % dataUrls.length];
      loader.load(url, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        mesh.material = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
      });
    });
  }

  private buildFloor(world: CANNON.World, groundMat: CANNON.Material): void {
    const floorBody = new CANNON.Body({
      mass: 0,
      material: groundMat,
    });
    floorBody.addShape(new CANNON.Plane());
    floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    world.addBody(floorBody);
    this.bodies.push(floorBody);

    const floorTex = this.createFloorTexture();
    floorTex.wrapS = THREE.RepeatWrapping;
    floorTex.wrapT = THREE.RepeatWrapping;
    floorTex.repeat.set(36, 36);

    const floorMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(420, 420),
      new THREE.MeshStandardMaterial({
        map: floorTex,
        roughness: this.def.theme === 'robotics_lab' ? 0.36 : 0.48,
        metalness: this.def.theme === 'robotics_lab' ? 0.15 : 0.06,
      })
    );
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.receiveShadow = true;
    this.group.add(floorMesh);
  }

  private createFloorTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = this.def.floorPrimary;
    ctx.fillRect(0, 0, 256, 256);

    if (this.def.theme === 'lia_lab') {
      // LIA Lab Basketweave Wood Parquet Tiles (alternating 4-slat squares)
      const tones = ['#734b2e', '#633f25', '#7e5334', '#58371f'];
      for (let qy = 0; qy < 2; qy++) {
        for (let qx = 0; qx < 2; qx++) {
          const ox = qx * 128;
          const oy = qy * 128;
          const horizontal = (qx + qy) % 2 === 0;
          for (let s = 0; s < 4; s++) {
            ctx.fillStyle = tones[(s + qx * 2 + qy) % tones.length];
            if (horizontal) {
              ctx.fillRect(ox + 2, oy + s * 32 + 2, 124, 28);
            } else {
              ctx.fillRect(ox + s * 32 + 2, oy + 2, 28, 124);
            }
          }
        }
      }
    } else if (this.def.theme === 'toy_room') {
      // Warm hardwood playroom planks
      ctx.fillStyle = this.def.floorSecondary;
      for (let y = 0; y < 256; y += 32) {
        ctx.fillRect(0, y, 256, 3);
        const jointX = ((y * 3) % 220) + 18;
        ctx.fillRect(jointX, y, 3, 32);
      }
    } else {
      // Polished concrete lab tiles with subtle reference crosshairs
      ctx.strokeStyle = this.def.floorSecondary;
      ctx.lineWidth = 3;
      ctx.strokeRect(0, 0, 256, 256);
      ctx.fillStyle = 'rgba(0, 200, 255, 0.14)';
      ctx.fillRect(124, 127, 8, 2);
      ctx.fillRect(127, 124, 2, 8);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private buildRoadRibbonAndWalls(world: CANNON.World, wallMat: CANNON.Material): void {
    const segments = 220;
    const halfWidth = this.def.roadWidth * 0.5;

    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i <= segments; i++) {
      const t = (i % segments) / segments;
      const { pos, right } = this.getPointAndForwardAt(t);
      const leftPt = pos.clone().addScaledVector(right, -halfWidth);
      const rightPt = pos.clone().addScaledVector(right, halfWidth);

      positions.push(leftPt.x, 0.03, leftPt.z);
      positions.push(rightPt.x, 0.03, rightPt.z);

      uvs.push(0, i * 0.35);
      uvs.push(1, i * 0.35);

      if (i < segments) {
        const base = i * 2;
        indices.push(base, base + 1, base + 2);
        indices.push(base + 1, base + 3, base + 2);
      }
    }

    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    roadGeo.setIndex(indices);
    roadGeo.computeVertexNormals();

    const roadTex = this.createRoadSurfaceTexture();
    roadTex.wrapS = THREE.RepeatWrapping;
    roadTex.wrapT = THREE.RepeatWrapping;

    const roadMesh = new THREE.Mesh(
      roadGeo,
      new THREE.MeshStandardMaterial({
        map: roadTex,
        roughness: 0.68,
        metalness: 0.08,
      })
    );
    roadMesh.receiveShadow = true;
    this.group.add(roadMesh);

    // Build alternating Re-Volt curb blocks + invisible smooth containment rails
    const curbA = new THREE.MeshStandardMaterial({ color: this.def.curbColorA, roughness: 0.45 });
    const curbB = new THREE.MeshStandardMaterial({ color: this.def.curbColorB, roughness: 0.45 });
    const wallSegments = 110;
    const wallOffset = halfWidth + 0.85;

    for (let i = 0; i < wallSegments; i++) {
      const t0 = i / wallSegments;
      const t1 = ((i + 1) % wallSegments) / wallSegments;
      const p0 = this.curve.getPointAt(t0);
      const p1 = this.curve.getPointAt(t1);
      const segVec = p1.clone().sub(p0);
      const segLen = segVec.length();
      const fwd = segVec.clone().normalize();
      const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
      const mid = p0.clone().add(p1).multiplyScalar(0.5);
      const yaw = Math.atan2(fwd.x, fwd.z);

      const mat = i % 2 === 0 ? curbA : curbB;
      const curbGeo = new THREE.BoxGeometry(0.62, 0.34, segLen * 1.04);

      for (const side of [-1, 1]) {
        const curbPos = mid.clone().addScaledVector(right, side * (halfWidth + 0.32));
        const curb = new THREE.Mesh(curbGeo, mat);
        curb.position.set(curbPos.x, 0.17, curbPos.z);
        curb.rotation.y = yaw;
        curb.castShadow = true;
        curb.receiveShadow = true;
        this.group.add(curb);

        // Physics containment barrier slightly behind curb
        const wallPos = mid.clone().addScaledVector(right, side * wallOffset);
        const wallBody = new CANNON.Body({ mass: 0, material: wallMat });
        wallBody.addShape(new CANNON.Box(new CANNON.Vec3(0.35, 1.4, segLen * 0.54)));
        wallBody.position.set(wallPos.x, 1.2, wallPos.z);
        wallBody.quaternion.setFromEuler(0, yaw, 0);
        world.addBody(wallBody);
        this.bodies.push(wallBody);
      }
    }
  }

  private createRoadSurfaceTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = this.def.theme === 'toy_room' ? '#242933' : '#1d222b';
    ctx.fillRect(0, 0, 256, 256);

    // Subtle asphalt grain
    for (let i = 0; i < 900; i++) {
      const g = 28 + Math.floor(Math.random() * 22);
      ctx.fillStyle = `rgb(${g},${g + 3},${g + 8})`;
      ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }

    // Edge racing lines
    ctx.fillStyle = this.def.theme === 'toy_room' ? '#ffffff' : '#ffd000';
    ctx.fillRect(10, 0, 6, 256);
    ctx.fillRect(240, 0, 6, 256);

    // Dashed centerline
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.fillRect(125, 24, 6, 96);
    ctx.fillRect(125, 156, 6, 76);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private buildStartGantry(): void {
    const { pos, forward, right } = this.getPointAndForwardAt(0);
    const yaw = Math.atan2(forward.x, forward.z);
    const halfW = this.def.roadWidth * 0.5 + 0.5;

    const gantry = new THREE.Group();
    gantry.position.set(pos.x, 0, pos.z);
    gantry.rotation.y = yaw;

    const pillarMat = new THREE.MeshStandardMaterial({
      color: 0x1d232d,
      metalness: 0.6,
      roughness: 0.3,
    });
    const pillarGeo = new THREE.BoxGeometry(0.55, 6.2, 0.55);
    const pL = new THREE.Mesh(pillarGeo, pillarMat);
    pL.position.set(-halfW, 3.1, 0);
    const pR = pL.clone();
    pR.position.x = halfW;

    const bannerTex = this.createBannerTexture(
      this.def.theme === 'lia_lab'
        ? 'LIA LAB // START'
        : this.def.theme === 'toy_room'
          ? 'RE-VOLT // START'
          : 'CV LAB // START'
    );
    const crossBeam = new THREE.Mesh(
      new THREE.BoxGeometry(halfW * 2 + 0.6, 1.35, 0.45),
      new THREE.MeshStandardMaterial({ map: bannerTex, roughness: 0.3 })
    );
    crossBeam.position.set(0, 5.7, 0);

    // Checkered start line strip on ground
    const checkerTex = this.createCheckerTexture();
    const lineStrip = new THREE.Mesh(
      new THREE.PlaneGeometry(this.def.roadWidth, 2.2),
      new THREE.MeshBasicMaterial({ map: checkerTex })
    );
    lineStrip.rotation.x = -Math.PI / 2;
    lineStrip.position.set(0, 0.05, 0);

    gantry.add(pL, pR, crossBeam, lineStrip);
    // Keep unused variable warning clear
    void right;
    this.group.add(gantry);
  }

  private createBannerTexture(label: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#10141c';
    ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = '#ffd000';
    ctx.fillRect(0, 0, 512, 12);
    ctx.fillRect(0, 116, 512, 12);
    ctx.font = '700 44px "Chakra Petch", sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 256, 66);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private createCheckerTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const sq = 16;
    for (let y = 0; y < 64; y += sq) {
      for (let x = 0; x < 256; x += sq) {
        ctx.fillStyle = (x / sq + y / sq) % 2 === 0 ? '#ffffff' : '#111419';
        ctx.fillRect(x, y, sq, sq);
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private buildRamps(world: CANNON.World, groundMat: CANNON.Material): void {
    for (const r of this.def.ramps) {
      const { pos, forward, right } = this.getPointAndForwardAt(r.splineT);
      const center = pos.clone().addScaledVector(right, r.lateralOffset);
      const yaw = Math.atan2(forward.x, forward.z);
      const slopeAngle = Math.atan2(r.height, r.length);
      const hypLen = Math.hypot(r.length, r.height);

      const rampMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(r.color),
        roughness: 0.42,
      });
      const slabGeo = new THREE.BoxGeometry(r.width, 0.35, hypLen);
      const rampMesh = new THREE.Mesh(slabGeo, rampMat);
      rampMesh.position.set(center.x, r.height * 0.5 - 0.1, center.z);
      rampMesh.rotation.set(-slopeAngle, yaw, 0, 'YXZ');
      rampMesh.castShadow = true;
      rampMesh.receiveShadow = true;
      this.group.add(rampMesh);

      const rampBody = new CANNON.Body({ mass: 0, material: groundMat });
      rampBody.addShape(new CANNON.Box(new CANNON.Vec3(r.width * 0.5, 0.18, hypLen * 0.5)));
      rampBody.position.set(center.x, r.height * 0.5 - 0.1, center.z);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-slopeAngle, yaw, 0, 'YXZ'));
      rampBody.quaternion.set(q.x, q.y, q.z, q.w);
      world.addBody(rampBody);
      this.bodies.push(rampBody);
    }
  }

  private buildCones(world: CANNON.World): void {
    const coneMat = new THREE.MeshStandardMaterial({ color: 0xff5a1f, roughness: 0.4 });
    const bandMat = new THREE.MeshStandardMaterial({ color: 0xf5f7fa, roughness: 0.3 });

    const coneSpots = [0.21, 0.23, 0.42, 0.44, 0.68, 0.7, 0.9];
    coneSpots.forEach((t, idx) => {
      const { pos, right } = this.getPointAndForwardAt(t);
      const offset = (idx % 2 === 0 ? 1 : -1) * (this.def.roadWidth * 0.28);
      const cPos = pos.clone().addScaledVector(right, offset);

      const coneGroup = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.1, 0.75), coneMat);
      base.position.y = -0.35;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.85, 12), coneMat);
      cone.position.y = 0.08;
      cone.castShadow = true;
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 0.2, 12), bandMat);
      stripe.position.y = 0.14;
      coneGroup.add(base, cone, stripe);
      this.group.add(coneGroup);

      const body = new CANNON.Body({
        mass: 2.2,
        linearDamping: 0.25,
        angularDamping: 0.35,
      });
      body.addShape(new CANNON.Box(new CANNON.Vec3(0.32, 0.42, 0.32)));
      body.position.set(cPos.x, 0.45, cPos.z);
      world.addBody(body);

      this.dynamicProps.push({ body, mesh: coneGroup });
    });
  }

  private buildToyRoomProps(): void {
    const letters = ['A', 'B', 'C', 'R', 'V', '1', '2', '3'];
    const palette = ['#e53e3e', '#3182ce', '#d69e2e', '#38a169'];

    for (let i = 0; i < 16; i++) {
      const t = i / 16;
      const { pos, right } = this.getPointAndForwardAt(t);
      const side = i % 2 === 0 ? 1 : -1;
      const blockPos = pos.clone().addScaledVector(right, side * (this.def.roadWidth * 0.5 + 5.5));
      const size = 4.2 + (i % 3) * 1.1;

      const tex = this.createAlphabetBlockTexture(
        letters[i % letters.length],
        palette[i % palette.length]
      );
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size, size, size),
        new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 })
      );
      mesh.position.set(blockPos.x, size * 0.5, blockPos.z);
      mesh.rotation.y = i * 0.7;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }

    // Giant playroom table towering beside the track for authentic 1:10 miniature scale
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x3b82c4, roughness: 0.5 });
    const topMat = new THREE.MeshStandardMaterial({ color: 0xe6cfa8, roughness: 0.45 });
    const tableGroup = new THREE.Group();
    tableGroup.position.set(18, 0, -4);
    const tableTop = new THREE.Mesh(new THREE.BoxGeometry(36, 1.4, 22), topMat);
    tableTop.position.y = 18;
    tableTop.castShadow = true;
    tableGroup.add(tableTop);
    for (const lx of [-15, 15]) {
      for (const lz of [-9, 9]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 18, 14), woodMat);
        leg.position.set(lx, 9, lz);
        leg.castShadow = true;
        tableGroup.add(leg);
      }
    }
    this.group.add(tableGroup);
  }

  private createAlphabetBlockTexture(letter: string, color: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#f3dfc1';
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = color;
    ctx.lineWidth = 24;
    ctx.strokeRect(16, 16, 224, 224);
    ctx.font = '700 138px "Chakra Petch", sans-serif';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, 128, 134);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private buildLiaLabProps(): void {
    const loader = new THREE.TextureLoader();
    const sofaPhotoTex = loader.load('/assets/lia_lab_sofa.png');
    sofaPhotoTex.colorSpace = THREE.SRGBColorSpace;
    const ringPhotoTex = loader.load('/assets/lia_lab_ringlight.png');
    ringPhotoTex.colorSpace = THREE.SRGBColorSpace;
    const logoTex = loader.load('/assets/lia_logo.png');
    logoTex.colorSpace = THREE.SRGBColorSpace;

    // 1. Giant LED Ring-Light & Tripod Over-Track Portal (from image_2.png)
    const ringSpot = this.getPointAndForwardAt(0.32);
    const ringYaw = Math.atan2(ringSpot.forward.x, ringSpot.forward.z);
    const ringGroup = new THREE.Group();
    ringGroup.position.set(ringSpot.pos.x, 0, ringSpot.pos.z);
    ringGroup.rotation.y = ringYaw;

    const standMat = new THREE.MeshStandardMaterial({ color: 0x161920, roughness: 0.4, metalness: 0.6 });
    const ledMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xe8f7ff,
      emissiveIntensity: 2.2,
      roughness: 0.1,
    });

    // Tripod legs straddling the track
    const halfSpan = this.def.roadWidth * 0.5 + 1.8;
    const legL = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.45, 9.5, 12), standMat);
    legL.position.set(-halfSpan, 4.75, 0);
    const legR = legL.clone();
    legR.position.x = halfSpan;
    const crossBar = new THREE.Mesh(new THREE.BoxGeometry(halfSpan * 2 + 0.8, 0.45, 0.45), standMat);
    crossBar.position.set(0, 9.4, 0);

    // Glowing LED Ring Light Halo above the cars
    const ringTorus = new THREE.Mesh(new THREE.TorusGeometry(6.2, 0.72, 16, 42), ledMat);
    ringTorus.position.set(0, 11.2, 0);

    // Smartphone holder clip inside the ring light
    const phoneMount = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.4, 0.5), standMat);
    phoneMount.position.set(0, 8.2, 0);

    ringGroup.add(legL, legR, crossBar, ringTorus, phoneMount);
    this.group.add(ringGroup);

    // 2. Plush Brown Tufted 2-Seater Sofa + Cream 3-Drawer Cabinet & Potted ZZ Plant (from image.png)
    const sofaGroup = new THREE.Group();
    sofaGroup.position.set(-28, 0, -24);
    sofaGroup.rotation.y = 0.35;

    const velvetMat = new THREE.MeshStandardMaterial({ color: 0x4b3b32, roughness: 0.78 });
    const sofaSeat = new THREE.Mesh(new THREE.BoxGeometry(28, 5.5, 13), velvetMat);
    sofaSeat.position.set(0, 2.75, 0);
    sofaSeat.castShadow = true;
    const sofaBack = new THREE.Mesh(new THREE.BoxGeometry(26, 9.5, 4.2), velvetMat);
    sofaBack.position.set(0, 9.5, -4.4);
    sofaBack.rotation.x = -0.08;
    sofaBack.castShadow = true;
    const armGeo = new THREE.BoxGeometry(3.6, 8.2, 13.4);
    const armL = new THREE.Mesh(armGeo, velvetMat);
    armL.position.set(-14.5, 4.1, 0);
    const armR = armL.clone();
    armR.position.x = 14.5;
    sofaGroup.add(sofaSeat, sofaBack, armL, armR);

    // Cream 3-drawer rolling filing cabinet next to the sofa
    const creamMat = new THREE.MeshStandardMaterial({ color: 0xded6c6, roughness: 0.45 });
    const handleMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.8, roughness: 0.2 });
    const cabinet = new THREE.Mesh(new THREE.BoxGeometry(8.5, 10.5, 9.5), creamMat);
    cabinet.position.set(-22, 5.25, 0.5);
    cabinet.castShadow = true;
    sofaGroup.add(cabinet);

    for (const dy of [2.4, 5.4, 8.2]) {
      const handle = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.28, 0.4), handleMat);
      handle.position.set(-22, dy, 5.4);
      sofaGroup.add(handle);
    }

    // Potted green ZZ Plant on top of the filing cabinet
    const potMat = new THREE.MeshStandardMaterial({ color: 0x1e2226, roughness: 0.6 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2e6f32, roughness: 0.4 });
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 1.6, 3.6, 14), potMat);
    pot.position.set(-22, 12.3, 0.5);
    sofaGroup.add(pot);

    for (let s = 0; s < 7; s++) {
      const angle = (s / 7) * Math.PI * 2;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.35, 5.5, 8), leafMat);
      stem.position.set(-22 + Math.cos(angle) * 1.3, 15.2, 0.5 + Math.sin(angle) * 1.3);
      stem.rotation.z = Math.cos(angle) * 0.42;
      stem.rotation.x = Math.sin(angle) * 0.42;
      sofaGroup.add(stem);
    }

    this.group.add(sofaGroup);

    // 3. Conference Table with Blue-Cushioned Chairs (from image_2.png)
    const tableGroup = new THREE.Group();
    tableGroup.position.set(22, 0, 10);
    tableGroup.rotation.y = -0.25;

    const deskTopMat = new THREE.MeshStandardMaterial({ color: 0xe8e2d5, roughness: 0.4 });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x1b1f26, roughness: 0.5 });
    const blueSeatMat = new THREE.MeshStandardMaterial({ color: 0x0d6efd, roughness: 0.55 });

    const tableTop = new THREE.Mesh(new THREE.BoxGeometry(34, 1.1, 16), deskTopMat);
    tableTop.position.y = 11.5;
    tableTop.castShadow = true;
    tableGroup.add(tableTop);

    for (const lx of [-15, 15]) {
      for (const lz of [-6.5, 6.5]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.9, 11.5, 0.9), frameMat);
        leg.position.set(lx, 5.75, lz);
        tableGroup.add(leg);
      }
    }

    // Blue-seat black-back conference chairs around table
    for (const cx of [-11, 0, 11]) {
      for (const side of [-1, 1]) {
        const chair = new THREE.Group();
        chair.position.set(cx, 0, side * 9.5);
        if (side === -1) chair.rotation.y = Math.PI;

        const seat = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.8, 5.0), blueSeatMat);
        seat.position.y = 6.2;
        const back = new THREE.Mesh(new THREE.BoxGeometry(5.2, 4.2, 0.7), frameMat);
        back.position.set(0, 9.2, 2.3);
        chair.add(seat, back);
        tableGroup.add(chair);
      }
    }

    // LIA Logo Holographic Banner suspended above the conference table
    const logoBanner = new THREE.Mesh(
      new THREE.PlaneGeometry(24, 14),
      new THREE.MeshBasicMaterial({
        map: logoTex,
        transparent: true,
        side: THREE.DoubleSide,
      })
    );
    logoBanner.position.set(0, 21.5, 0);
    tableGroup.add(logoBanner);

    this.group.add(tableGroup);

    // 4. Perimeter LIA Lab Photo Murals & Whiteboard Walls
    const murals: Array<{ x: number; z: number; ry: number; tex: THREE.Texture; w: number; h: number }> = [
      { x: 0, z: -96, ry: 0, tex: sofaPhotoTex, w: 68, h: 32 },
      { x: 116, z: 0, ry: -Math.PI / 2, tex: ringPhotoTex, w: 48, h: 36 },
      { x: 0, z: 98, ry: Math.PI, tex: sofaPhotoTex, w: 68, h: 32 },
      { x: -116, z: 0, ry: Math.PI / 2, tex: logoTex, w: 48, h: 28 },
    ];

    for (const m of murals) {
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(m.w, m.h),
        new THREE.MeshBasicMaterial({ map: m.tex, transparent: m.tex === logoTex, side: THREE.DoubleSide })
      );
      plane.position.set(m.x, 16.5, m.z);
      plane.rotation.y = m.ry;
      this.group.add(plane);
      this.labPhotoMeshes.push(plane);
    }
  }

  private buildRoboticsLabProps(): void {
    const aluMat = new THREE.MeshStandardMaterial({
      color: 0xbac4d0,
      metalness: 0.72,
      roughness: 0.25,
    });
    const benchTopMat = new THREE.MeshStandardMaterial({
      color: 0x222933,
      roughness: 0.4,
    });

    // 80/20 Aluminum Extrusion Camera Calibration Portals over the track
    const portalTs = [0.28, 0.72];
    const calibTex = this.createCheckerCalibrationTexture();

    for (const ptT of portalTs) {
      const { pos, forward } = this.getPointAndForwardAt(ptT);
      const yaw = Math.atan2(forward.x, forward.z);
      const halfW = this.def.roadWidth * 0.5 + 1.2;

      const portal = new THREE.Group();
      portal.position.set(pos.x, 0, pos.z);
      portal.rotation.y = yaw;

      const postL = new THREE.Mesh(new THREE.BoxGeometry(0.45, 7.5, 0.45), aluMat);
      postL.position.set(-halfW, 3.75, 0);
      const postR = postL.clone();
      postR.position.x = halfW;
      const beam = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2 + 0.6, 0.45, 0.45), aluMat);
      beam.position.set(0, 7.5, 0);

      // Calibration target + custom Lab Photo display panel
      const board = new THREE.Mesh(
        new THREE.PlaneGeometry(7.2, 3.4),
        new THREE.MeshBasicMaterial({ map: calibTex, side: THREE.DoubleSide })
      );
      board.position.set(0, 5.5, 0);
      this.labPhotoMeshes.push(board);

      portal.add(postL, postR, beam, board);
      this.group.add(portal);
    }

    // Giant Laboratory Workbenches & Custom Photo Wall Murals around the room
    const benchCoords = [
      { x: -12, z: 6, rot: 0.2 },
      { x: 34, z: -18, rot: -0.5 },
    ];
    for (const b of benchCoords) {
      const bench = new THREE.Group();
      bench.position.set(b.x, 0, b.z);
      bench.rotation.y = b.rot;

      const top = new THREE.Mesh(new THREE.BoxGeometry(28, 0.9, 14), benchTopMat);
      top.position.y = 14;
      top.castShadow = true;
      bench.add(top);

      for (const lx of [-12.5, 12.5]) {
        for (const lz of [-5.8, 5.8]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.8, 14, 0.8), aluMat);
          leg.position.set(lx, 7, lz);
          bench.add(leg);
        }
      }

      // Lab Monitor / Custom Photo Screen above workbench
      const monitorScreen = new THREE.Mesh(
        new THREE.PlaneGeometry(14, 7.8),
        new THREE.MeshBasicMaterial({ map: calibTex, side: THREE.DoubleSide })
      );
      monitorScreen.position.set(0, 19.2, 0);
      bench.add(monitorScreen);
      this.labPhotoMeshes.push(monitorScreen);

      this.group.add(bench);
    }

    // Perimeter Laboratory Photo Billboards so uploaded lab pictures surround the arena
    const wallPositions = [
      { x: 0, z: -98, ry: 0 },
      { x: 118, z: 0, ry: -Math.PI / 2 },
      { x: 0, z: 102, ry: Math.PI },
      { x: -118, z: 0, ry: Math.PI / 2 },
    ];
    const defaultLabTex = new THREE.TextureLoader().load('/assets/robotics_lab_track.jpg');
    defaultLabTex.colorSpace = THREE.SRGBColorSpace;

    for (const wp of wallPositions) {
      const mural = new THREE.Mesh(
        new THREE.PlaneGeometry(54, 28),
        new THREE.MeshBasicMaterial({ map: defaultLabTex, side: THREE.DoubleSide })
      );
      mural.position.set(wp.x, 15, wp.z);
      mural.rotation.y = wp.ry;
      this.group.add(mural);
      this.labPhotoMeshes.push(mural);
    }
  }

  private createCheckerCalibrationTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#f4f6f9';
    ctx.fillRect(0, 0, 512, 256);

    const sq = 32;
    for (let y = 32; y < 224; y += sq) {
      for (let x = 32; x < 256; x += sq) {
        ctx.fillStyle = (x / sq + y / sq) % 2 === 0 ? '#11161d' : '#ffffff';
        ctx.fillRect(x, y, sq, sq);
      }
    }

    ctx.fillStyle = '#11161d';
    ctx.font = '700 26px "JetBrains Mono", monospace';
    ctx.fillText('CV CALIBRATION GATE', 276, 98);
    ctx.fillStyle = '#0088cc';
    ctx.font = '500 18px "JetBrains Mono", monospace';
    ctx.fillText('UPLOAD LAB PHOTOS', 276, 136);
    ctx.fillText('TO CUSTOMIZE ARENA', 276, 162);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  public syncDynamicProps(): void {
    for (const dp of this.dynamicProps) {
      dp.mesh.position.set(dp.body.position.x, dp.body.position.y, dp.body.position.z);
      dp.mesh.quaternion.set(
        dp.body.quaternion.x,
        dp.body.quaternion.y,
        dp.body.quaternion.z,
        dp.body.quaternion.w
      );
    }
  }

  public dispose(world: CANNON.World, scene: THREE.Scene): void {
    scene.remove(this.group);
    for (const b of this.bodies) {
      world.removeBody(b);
    }
    for (const dp of this.dynamicProps) {
      world.removeBody(dp.body);
    }
  }
}
