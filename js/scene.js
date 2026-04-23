import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createPigMesh, createPigBody, PIG } from './pig.js';

const FELT_SIZE = 22;   // length of square felt
const WALL_H = 1.5;
const WALL_T = 0.4;

export class PigScene {
  constructor(canvas) {
    this.canvas = canvas;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a0f08);
    this.scene.fog = new THREE.Fog(0x1a0f08, 30, 60);

    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 200);
    this.camera.position.set(0, 18, 14);
    this.camera.lookAt(0, 0, 0);

    this._buildLights();
    this._buildTable();
    this._buildPhysics();

    this.pigs = []; // { mesh, body }
    this._buildPigs();

    this.clock = new THREE.Clock();
    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', this._onResize);
    this._onResize();

    this._animate = this._animate.bind(this);
    this.renderer.setAnimationLoop(this._animate);
  }

  _buildLights() {
    const hemi = new THREE.HemisphereLight(0xfff3d6, 0x2a1a0a, 0.65);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xffffff, 1.05);
    key.position.set(8, 16, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const s = 14;
    key.shadow.camera.left = -s;
    key.shadow.camera.right = s;
    key.shadow.camera.top = s;
    key.shadow.camera.bottom = -s;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 40;
    key.shadow.bias = -0.0005;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0xfbd48c, 0.35);
    fill.position.set(-10, 8, -6);
    this.scene.add(fill);
  }

  _buildTable() {
    const feltGeom = new THREE.BoxGeometry(FELT_SIZE, 0.4, FELT_SIZE);
    const feltMat = new THREE.MeshStandardMaterial({
      color: 0x2f6a42,
      roughness: 0.95,
      metalness: 0,
    });
    const felt = new THREE.Mesh(feltGeom, feltMat);
    felt.position.y = -0.2;
    felt.receiveShadow = true;
    this.scene.add(felt);

    // Wood rail
    const railMat = new THREE.MeshStandardMaterial({ color: 0x4a2b14, roughness: 0.7 });
    const railT = 0.6;
    const railH = 0.45;
    const railOuter = FELT_SIZE + railT * 2;
    const positions = [
      [0, railH / 2 - 0.2, FELT_SIZE / 2 + railT / 2, railOuter, railH, railT],
      [0, railH / 2 - 0.2, -FELT_SIZE / 2 - railT / 2, railOuter, railH, railT],
      [FELT_SIZE / 2 + railT / 2, railH / 2 - 0.2, 0, railT, railH, FELT_SIZE],
      [-FELT_SIZE / 2 - railT / 2, railH / 2 - 0.2, 0, railT, railH, FELT_SIZE],
    ];
    for (const [x, y, z, w, h, d] of positions) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), railMat);
      rail.position.set(x, y, z);
      rail.castShadow = true;
      rail.receiveShadow = true;
      this.scene.add(rail);
    }

    // Subtle decorative stitching (emissive thin frame)
    const frameGeom = new THREE.BoxGeometry(FELT_SIZE - 1.2, 0.01, FELT_SIZE - 1.2);
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x5fa078,
      emissive: 0x3c6d4b,
      emissiveIntensity: 0.3,
      roughness: 1,
    });
    const frame = new THREE.Mesh(frameGeom, frameMat);
    frame.position.y = 0.003;
    this.scene.add(frame);
  }

  _buildPhysics() {
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -22, 0) });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.allowSleep = true;
    this.world.defaultContactMaterial.friction = 0.35;
    this.world.defaultContactMaterial.restitution = 0.35;

    // Ground
    const groundMat = new CANNON.Material('ground');
    this.pigMat = new CANNON.Material('pig');

    const pigGround = new CANNON.ContactMaterial(this.pigMat, groundMat, {
      friction: 0.45,
      restitution: 0.28,
    });
    const pigPig = new CANNON.ContactMaterial(this.pigMat, this.pigMat, {
      friction: 0.3,
      restitution: 0.32,
    });
    this.world.addContactMaterial(pigGround);
    this.world.addContactMaterial(pigPig);

    const groundBody = new CANNON.Body({ mass: 0, material: groundMat });
    groundBody.addShape(new CANNON.Plane());
    groundBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
    this.world.addBody(groundBody);

    // Walls (so pigs can't fly off the table)
    const wallShape = new CANNON.Box(new CANNON.Vec3(FELT_SIZE / 2, WALL_H, WALL_T / 2));
    const wallShapeZ = new CANNON.Box(new CANNON.Vec3(WALL_T / 2, WALL_H, FELT_SIZE / 2));
    const walls = [
      { shape: wallShape, pos: [0, WALL_H, FELT_SIZE / 2 + WALL_T / 2] },
      { shape: wallShape, pos: [0, WALL_H, -FELT_SIZE / 2 - WALL_T / 2] },
      { shape: wallShapeZ, pos: [FELT_SIZE / 2 + WALL_T / 2, WALL_H, 0] },
      { shape: wallShapeZ, pos: [-FELT_SIZE / 2 - WALL_T / 2, WALL_H, 0] },
    ];
    for (const w of walls) {
      const b = new CANNON.Body({ mass: 0, material: groundMat });
      b.addShape(w.shape);
      b.position.set(w.pos[0], w.pos[1], w.pos[2]);
      this.world.addBody(b);
    }
  }

  _buildPigs() {
    for (let i = 0; i < 2; i++) {
      const dotSide = i === 0 ? 'right' : 'left';
      const mesh = createPigMesh({ dotSide });
      mesh.castShadow = true;
      this.scene.add(mesh);

      const body = createPigBody(this.pigMat);
      this.world.addBody(body);

      this.pigs.push({ mesh, body, dotSide });
    }
    this.resetPigs();
  }

  // Place pigs on the near side of the table ready to be flung.
  resetPigs() {
    const startZ = 7.5; // near the player
    const startY = PIG.bodyH + 0.6;
    const separation = 1.6;
    for (let i = 0; i < this.pigs.length; i++) {
      const { body } = this.pigs[i];
      body.velocity.setZero();
      body.angularVelocity.setZero();
      body.force.setZero();
      body.torque.setZero();
      body.position.set((i === 0 ? -1 : 1) * (separation / 2), startY, startZ);
      // Yaw them to face roughly forward (-Z), small random to feel alive
      const q = new CANNON.Quaternion();
      q.setFromEuler(0, Math.PI + (Math.random() - 0.5) * 0.3, 0);
      body.quaternion.copy(q);
      body.wakeUp();
    }
  }

  // Apply a roll impulse. `direction` is a normalized 2D vector in screen space
  // where +y is "up the screen" (towards far end of table from camera).
  // `power` in [0, 1]. Adds randomized spin plus per-pig lateral scatter so
  // the two pigs don't travel in lockstep.
  rollPigs(direction, power) {
    const p = THREE.MathUtils.clamp(power, 0.15, 1);
    const worldDir = new THREE.Vector3(direction.x, 0, -direction.y).normalize();
    // Lateral axis (perpendicular in the XZ plane) for scatter
    const lateral = new THREE.Vector3(-worldDir.z, 0, worldDir.x);
    const baseSpeed = 9 + 10 * p;
    const upKick = 3.5 + 4 * p;

    for (let i = 0; i < this.pigs.length; i++) {
      const { body } = this.pigs[i];
      // Outward lateral kick: pig 0 goes left, pig 1 goes right (of travel dir)
      const sideSign = i === 0 ? -1 : 1;
      const sideSpread = (1.2 + Math.random() * 1.8) * sideSign;
      const forwardVar = (Math.random() - 0.5) * 2.5;

      const v = worldDir.clone().multiplyScalar(baseSpeed + forwardVar)
        .addScaledVector(lateral, sideSpread);
      body.velocity.set(v.x, upKick + Math.random() * 1.5, v.z);
      body.angularVelocity.set(
        (Math.random() - 0.5) * (12 + 22 * p),
        (Math.random() - 0.5) * (6 + 12 * p),
        (Math.random() - 0.5) * (14 + 26 * p)
      );
      body.wakeUp();
    }
  }

  // Returns true when both pigs have essentially stopped moving.
  pigsAtRest() {
    for (const { body } of this.pigs) {
      if (body.velocity.length() > 0.25) return false;
      if (body.angularVelocity.length() > 0.25) return false;
      // also ensure they're near the table, not airborne
      if (body.position.y > 2.0 && body.velocity.length() > 0.05) return false;
    }
    return true;
  }

  // Expose for scoring
  getPigStates() {
    return this.pigs.map(({ body, mesh, dotSide }) => ({
      position: body.position.clone(),
      quaternion: body.quaternion.clone(),
      mesh,
      body,
      dotSide,
    }));
  }

  _syncMeshes() {
    for (const { body, mesh } of this.pigs) {
      mesh.position.copy(body.position);
      mesh.quaternion.copy(body.quaternion);
    }
  }

  _onResize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Adjust camera distance when aspect is very tall (portrait phone)
    const portraitBoost = h > w ? 1.15 : 1.0;
    this.camera.position.set(0, 18 * portraitBoost, 14 * portraitBoost);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
  }

  _animate() {
    const dt = Math.min(this.clock.getDelta(), 1 / 30);
    this.world.step(1 / 60, dt, 3);
    this._syncMeshes();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('orientationchange', this._onResize);
    this.renderer.setAnimationLoop(null);
    this.renderer.dispose();
  }
}
