import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// Pig proportions (in meters-ish units; table ~ 20 across)
export const PIG = {
  bodyLen: 1.6,
  bodyH: 1.05,
  bodyW: 1.0,
  headR: 0.55,
  snoutR: 0.32,
  snoutLen: 0.28,
  legR: 0.13,
  legH: 0.55,
};

const PINK = 0xffb3c1;
const PINK_DARK = 0xff8fa5;
const NOSE = 0xdd6e85;
const EYE = 0x2b1d12;
const DOT = 0x2b1d12;

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.75,
    metalness: 0.0,
    ...opts,
  });
}

// Builds a procedural low-poly pig. Optional `dotSide` = 'left' | 'right' | null
// places a small dot on one side, used for the "Sider" scoring position.
export function createPigMesh({ dotSide = 'right' } = {}) {
  const group = new THREE.Group();
  group.name = 'pig';

  const pink = mat(PINK);
  const pinkDark = mat(PINK_DARK);
  const nose = mat(NOSE);
  const eye = mat(EYE, { roughness: 0.4 });

  // Body (ellipsoid via scaled sphere)
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 20, 16),
    pink
  );
  body.scale.set(PIG.bodyLen / 1.1, PIG.bodyH / 1.1, PIG.bodyW / 1.1);
  body.castShadow = true;
  body.receiveShadow = true;
  body.userData.tintable = 'body';
  group.add(body);

  // Head
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(PIG.headR, 18, 14),
    pink
  );
  head.position.set(PIG.bodyLen * 0.42, 0.05, 0);
  head.castShadow = true;
  head.userData.tintable = 'body';
  group.add(head);

  // Snout (short cylinder)
  const snoutGeom = new THREE.CylinderGeometry(PIG.snoutR, PIG.snoutR * 0.95, PIG.snoutLen, 14);
  const snout = new THREE.Mesh(snoutGeom, nose);
  snout.rotation.z = Math.PI / 2;
  snout.position.set(PIG.bodyLen * 0.42 + PIG.headR * 0.82, -0.02, 0);
  snout.castShadow = true;
  group.add(snout);

  // Nostrils (two small dark discs on snout face)
  const nostrilGeom = new THREE.CircleGeometry(0.045, 10);
  const nostrilMat = mat(0x2a0d13, { roughness: 1 });
  for (const z of [-0.1, 0.1]) {
    const n = new THREE.Mesh(nostrilGeom, nostrilMat);
    n.rotation.y = Math.PI / 2;
    n.position.set(
      PIG.bodyLen * 0.42 + PIG.headR * 0.82 + PIG.snoutLen / 2 + 0.001,
      -0.02,
      z
    );
    group.add(n);
  }

  // Eyes
  const eyeGeom = new THREE.SphereGeometry(0.06, 8, 6);
  for (const z of [-0.25, 0.25]) {
    const e = new THREE.Mesh(eyeGeom, eye);
    e.position.set(PIG.bodyLen * 0.42 + PIG.headR * 0.55, PIG.headR * 0.45, z);
    group.add(e);
  }

  // Ears (flat cones, tipped forward)
  const earGeom = new THREE.ConeGeometry(0.18, 0.28, 4);
  for (const z of [-0.3, 0.3]) {
    const earMat = mat(PINK_DARK);
    const ear = new THREE.Mesh(earGeom, earMat);
    ear.position.set(PIG.bodyLen * 0.3, PIG.headR * 0.85, z);
    ear.rotation.z = -0.3;
    ear.rotation.x = z < 0 ? 0.2 : -0.2;
    ear.castShadow = true;
    ear.userData.tintable = 'accent';
    group.add(ear);
  }

  // Legs (4 cylinders under body)
  const legGeom = new THREE.CylinderGeometry(PIG.legR, PIG.legR * 0.9, PIG.legH, 10);
  const legPositions = [
    [PIG.bodyLen * 0.28, -PIG.bodyH * 0.5 - PIG.legH * 0.25, PIG.bodyW * 0.32],
    [PIG.bodyLen * 0.28, -PIG.bodyH * 0.5 - PIG.legH * 0.25, -PIG.bodyW * 0.32],
    [-PIG.bodyLen * 0.3, -PIG.bodyH * 0.5 - PIG.legH * 0.25, PIG.bodyW * 0.32],
    [-PIG.bodyLen * 0.3, -PIG.bodyH * 0.5 - PIG.legH * 0.25, -PIG.bodyW * 0.32],
  ];
  for (const p of legPositions) {
    const leg = new THREE.Mesh(legGeom, pinkDark);
    leg.position.set(p[0], p[1], p[2]);
    leg.castShadow = true;
    leg.userData.tintable = 'accent';
    group.add(leg);
  }

  // Curly tail (torus)
  const tailGeom = new THREE.TorusGeometry(0.14, 0.05, 8, 14, Math.PI * 1.6);
  const tail = new THREE.Mesh(tailGeom, pinkDark);
  tail.position.set(-PIG.bodyLen * 0.52, PIG.bodyH * 0.2, 0);
  tail.rotation.y = Math.PI / 2;
  tail.rotation.z = 0.3;
  tail.castShadow = true;
  tail.userData.tintable = 'accent';
  group.add(tail);

  // Big painted dot on one side. Sized so the player can clearly tell at a
  // glance whether the dot side or the plain side landed up — small enough
  // not to wrap around the curvature, large enough to read across the table.
  if (dotSide) {
    const zSign = dotSide === 'left' ? -1 : 1;
    const surfaceZ = zSign * (PIG.bodyW * 0.495);

    // Faint outer halo so the dot reads from any camera angle.
    const halo = new THREE.Mesh(
      new THREE.CircleGeometry(0.32, 24),
      mat(0xffe9d1, { roughness: 1, transparent: true, opacity: 0.55 })
    );
    halo.position.set(0.05, -0.05, surfaceZ);
    halo.rotation.y = zSign > 0 ? Math.PI / 2 : -Math.PI / 2;
    halo.position.z += zSign * 0.001;
    group.add(halo);

    // Bold dark spot.
    const dot = new THREE.Mesh(
      new THREE.CircleGeometry(0.24, 24),
      mat(DOT, { roughness: 1 })
    );
    dot.position.set(0.05, -0.05, surfaceZ);
    dot.rotation.y = zSign > 0 ? Math.PI / 2 : -Math.PI / 2;
    dot.position.z += zSign * 0.002;
    group.add(dot);
  }

  // Tint variations to differentiate two pigs subtly
  return group;
}

// Tint pig body/accent meshes to a player color. Body gets the exact color;
// accent parts (ears, legs, tail) get a darker shade for contrast.
export function tintPig(group, tint) {
  const color = new THREE.Color(tint);
  const dark = color.clone().multiplyScalar(0.75);
  group.traverse((o) => {
    if (!o.isMesh || !o.userData || !o.userData.tintable) return;
    if (!o.material.__cloned) {
      o.material = o.material.clone();
      o.material.__cloned = true;
    }
    if (o.userData.tintable === 'body') o.material.color.copy(color);
    else if (o.userData.tintable === 'accent') o.material.color.copy(dark);
  });
}

// Physics body. A near-full-size core box does the heavy lifting so the pig
// rests cleanly on its faces (sides → Sider, top → Razorback, bottom →
// Trotter). A single snout sphere out front sticks past the box so the pig
// tips forward during tumble and Snouter is physically reachable. Earlier
// versions wrapped the box in big rump/shoulder spheres, but those caps
// extended beyond every box face and the pig perched on sphere curves at
// rest — most rolls came out as Leaning Jowler instead of clean siders.
export function createPigBody(material) {
  const body = new CANNON.Body({
    mass: 0.75,
    material,
    angularDamping: 0.06,
    linearDamping: 0.10,
    allowSleep: true,
    sleepSpeedLimit: 0.28,
    sleepTimeLimit: 0.35,
  });

  const coreHalf = new CANNON.Vec3(
    PIG.bodyLen * 0.46,
    PIG.bodyH * 0.46,
    PIG.bodyW * 0.46
  );
  body.addShape(new CANNON.Box(coreHalf));

  // Snout sphere placed past the front face of the box so it never lifts
  // the body off a face during a clean rest.
  const snoutOffsetX = PIG.bodyLen * 0.46 + PIG.snoutR * 0.6;
  body.addShape(
    new CANNON.Sphere(PIG.snoutR),
    new CANNON.Vec3(snoutOffsetX, -0.05, 0)
  );

  return body;
}

// Determine the Pass the Pigs scoring position directly from the physics
// rest pose. `dotSide` is the side of the pig where the painted dot lives:
//   'right' → dot on +Z face, 'left' → dot on -Z face.
// Returns one of:
//   'side-dot', 'side-plain', 'razorback', 'trotter', 'snouter', 'jowler'
export function detectPigPosition(bodyQuat, dotSide = 'right') {
  const up = new THREE.Vector3(0, 1, 0);
  const localX = new THREE.Vector3(1, 0, 0).applyQuaternion(bodyQuat); // toward snout
  const localY = new THREE.Vector3(0, 1, 0).applyQuaternion(bodyQuat); // toward back
  const localZ = new THREE.Vector3(0, 0, 1).applyQuaternion(bodyQuat); // toward +Z side

  // Whichever local axis most aligns with world-up is the face that is "up".
  const axes = [
    { name: 'Y+', v: localY },
    { name: 'Y-', v: localY.clone().negate() },
    { name: 'Z+', v: localZ },
    { name: 'Z-', v: localZ.clone().negate() },
    { name: 'X+', v: localX },
    { name: 'X-', v: localX.clone().negate() },
  ];
  let best = axes[0];
  let bestDot = -Infinity;
  for (const a of axes) {
    const d = a.v.dot(up);
    if (d > bestDot) { bestDot = d; best = a; }
  }

  // Strongly tilted rest (no face flat against the table) → Leaning Jowler.
  // A clean face-down rest gives dot >= ~0.98; a real snout+ear+leg lean
  // is well below 0.7. Threshold 0.70 corresponds to a ~45° tilt — only
  // genuinely diagonal rests qualify, so normal sides aren't sniped into
  // jowlers when the pig settles with a small wobble.
  if (bestDot < 0.70) return 'jowler';

  const dotOnPlusZ = dotSide === 'right';
  switch (best.name) {
    case 'Y+': return 'trotter';       // belly-down, standing on feet
    case 'Y-': return 'razorback';     // belly-up, back on table
    case 'X-': return 'snouter';       // tail-up, balanced on snout
    case 'X+': return 'razorback';     // tail-down (unstable) — map to back
    case 'Z+': return dotOnPlusZ ? 'side-dot' : 'side-plain';
    case 'Z-': return dotOnPlusZ ? 'side-plain' : 'side-dot';
    default:   return 'side-plain';
  }
}
