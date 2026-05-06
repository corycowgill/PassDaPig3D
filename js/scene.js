import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createPigMesh, createPigBody } from './pig.js';

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
    // Gravity heavier than Earth so the new heavier compound pigs (trunk +
    // head + snout + tail-bump + 4 legs) still settle quickly. Light enough
    // that the pigs tumble a few times after first contact instead of
    // pancaking on impact.
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -16, 0) });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.allowSleep = true;
    this.world.defaultContactMaterial.friction = 0.3;
    this.world.defaultContactMaterial.restitution = 0.2;

    // Ground
    const groundMat = new CANNON.Material('ground');
    this.pigMat = new CANNON.Material('pig');

    // Felt is grippy enough to convert linear motion into tumble, not so
    // bouncy that pigs jackrabbit across the table.
    const pigGround = new CANNON.ContactMaterial(this.pigMat, groundMat, {
      friction: 0.55,
      restitution: 0.12,
    });
    const pigPig = new CANNON.ContactMaterial(this.pigMat, this.pigMat, {
      friction: 0.35,
      restitution: 0.18,
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
    // Both pigs share the same dotSide so a Sider (same face up) and a Pig
    // Out (opposite faces up) can both occur — see scoring detection.
    for (let i = 0; i < 2; i++) {
      const dotSide = 'right';
      const mesh = createPigMesh({ dotSide });
      mesh.castShadow = true;
      this.scene.add(mesh);

      const body = createPigBody(this.pigMat);
      this.world.addBody(body);

      this.pigs.push({ mesh, body, dotSide });
    }

    // Track any pig-pig contact during the active roll. cannon-es fires this
    // body 'collide' event whenever a new contact is made, so a single brief
    // bounce off the partner pig is enough to flip the flag — exactly the
    // semantics of "Makin' Bacon / Oinker": if the two pigs touch at any
    // point during the throw, the turn busts.
    this._pigsContacted = false;
    const [p0, p1] = this.pigs;
    p0.body.addEventListener('collide', (e) => {
      if (e.body === p1.body) this._pigsContacted = true;
    });
    p1.body.addEventListener('collide', (e) => {
      if (e.body === p0.body) this._pigsContacted = true;
    });

    this.resetPigs();
  }

  // True if the two pigs touched (per physics collision events) at any point
  // since the last resetPigs() call. The detector also runs a generous
  // distance backup at scoring time in game.js — collisions during fast
  // bounces can occasionally be missed by an event listener, but a touch at
  // rest is always caught by the proximity check.
  pigsContactedDuringRoll() {
    return this._pigsContacted;
  }

  // Place pigs on the near side of the table ready to be flung. Slight
  // random tilt so the throw doesn't always start from the same pose —
  // gives the rolls some character right out of the cup.
  resetPigs() {
    // New roll → forget any prior pig-pig contacts.
    this._pigsContacted = false;
    const startZ = 7.5;
    // Start above the felt high enough to clear the legs (which now extend
    // ~0.79 below the body center) so the first frame of the throw isn't
    // already inside the table.
    const startY = 1.3;
    const separation = 1.7;
    for (let i = 0; i < this.pigs.length; i++) {
      const { body } = this.pigs[i];
      body.velocity.setZero();
      body.angularVelocity.setZero();
      body.force.setZero();
      body.torque.setZero();
      body.position.set((i === 0 ? -1 : 1) * (separation / 2), startY, startZ);
      const q = new CANNON.Quaternion();
      q.setFromEuler(
        (Math.random() - 0.5) * 0.5,
        Math.PI + (Math.random() - 0.5) * 0.6,
        (Math.random() - 0.5) * 0.5
      );
      body.quaternion.copy(q);
      body.wakeUp();
    }
  }

  // Apply a throw. `direction` is a normalized 2D vector in screen space
  // where +y is "up the screen" (towards the far rail). `power` in [0, 1].
  //
  // The throw puts most of the angular momentum into a forward "topspin"
  // (rotation around the horizontal axis perpendicular to the throw),
  // which is how a pig leaves the cup tumbling end-over-end. A small
  // wobble is layered on so the two pigs diverge and rare poses (snouter,
  // jowler) become physically reachable.
  rollPigs(direction, power) {
    const p = THREE.MathUtils.clamp(power, 0.15, 1);
    const worldDir = new THREE.Vector3(direction.x, 0, -direction.y).normalize();
    // Horizontal axis perpendicular to the throw → "tumble axis".
    const tumbleAxis = new THREE.Vector3()
      .crossVectors(new THREE.Vector3(0, 1, 0), worldDir)
      .normalize();
    // Rightward axis used to scatter the two pigs apart in flight.
    const lateral = new THREE.Vector3(-worldDir.z, 0, worldDir.x).normalize();

    // Tuned for the new compound body (heavier moment of inertia from the
    // distributed leg/snout/tail shapes). More tumble, slightly faster
    // forward toss, gentler upward arc so the pigs hit the felt tumbling
    // sideways rather than peaking high and slapping straight down.
    const baseSpeed = 7.0 + 7.5 * p;
    const upKick = 2.6 + 2.2 * p;
    const tumble = 11 + 17 * p;
    const wobble = 1.8 + 4.5 * p;

    for (let i = 0; i < this.pigs.length; i++) {
      const { body } = this.pigs[i];
      const sideSign = i === 0 ? -1 : 1;
      const sideSpread = sideSign * (0.8 + Math.random() * 1.2);
      const forwardVar = (Math.random() - 0.5) * 1.4;

      const v = worldDir.clone()
        .multiplyScalar(baseSpeed + forwardVar)
        .addScaledVector(lateral, sideSpread);
      body.velocity.set(v.x, upKick + (Math.random() - 0.5) * 0.6, v.z);

      const ang = tumbleAxis.clone().multiplyScalar(tumble * (0.85 + Math.random() * 0.3));
      ang.x += (Math.random() - 0.5) * wobble;
      ang.y += (Math.random() - 0.5) * wobble * 0.6;
      ang.z += (Math.random() - 0.5) * wobble;
      body.angularVelocity.set(ang.x, ang.y, ang.z);
      body.wakeUp();
    }
  }

  // Returns true when both pigs have essentially stopped moving.
  pigsAtRest() {
    for (const { body } of this.pigs) {
      if (body.velocity.length() > 0.18) return false;
      if (body.angularVelocity.length() > 0.18) return false;
      // also ensure they're near the table, not airborne
      if (body.position.y > 2.0 && body.velocity.length() > 0.04) return false;
    }
    return true;
  }

  // Forcibly halt the pigs and put them to sleep. Used as a safety net when
  // the rest-detection loop times out so scoring reads a stable orientation.
  forceSleepPigs() {
    for (const { body } of this.pigs) {
      body.velocity.setZero();
      body.angularVelocity.setZero();
      body.sleep();
    }
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
