// Skeleton definition: proportions derived from appearance (height/build) and the THREE.Bone hierarchy.
//
// Character space (bind pose): Y up, +Z = forward (chest), +X = the character's LEFT. Feet on y = 0.
// Bone conventions:
//   spine chain (pelvis, spine, chest, neck, head, clavicles, feet): local axes == character axes in bind pose.
//   limbs (thigh, shin, upperArm, forearm, hand): local -Y runs along the bone toward the child joint,
//   local +Z is the anterior side (knee cap / direction the elbow flexes toward).
import * as THREE from 'three';
import { clamp } from './util.js';

export const BONE_NAMES = [
  'pelvis', 'spine', 'chest', 'neck', 'head',
  'clavL', 'upperArmL', 'forearmL', 'handL',
  'clavR', 'upperArmR', 'forearmR', 'handR',
  'thighL', 'shinL', 'footL',
  'thighR', 'shinR', 'footR',
];
export const BI = Object.fromEntries(BONE_NAMES.map((n, i) => [n, i]));
/** maps a left bone index to the right one and vice versa (for mirroring geometry) */
export const MIRROR_BONE = BONE_NAMES.map((n) => {
  if (n.endsWith('L')) return BI[n.slice(0, -1) + 'R'];
  if (n.endsWith('R')) return BI[n.slice(0, -1) + 'L'];
  return BI[n];
});

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export function makeDims(app) {
  const h = clamp(app.height ?? 0.5);
  const b = clamp(app.build ?? 0.5);
  const H = 1.65 + 0.27 * h;
  const k = H / 1.78;
  const d = {
    H, k, b,
    girth: 0.86 + 0.32 * b, // torso girth multiplier
    limbG: 0.88 + 0.26 * b, // limb girth multiplier
    sw: 0.95 + 0.1 * b, // shoulder width multiplier
    ankleH: 0.083 * k,
    shin: 0.425 * k,
    thigh: 0.445 * k,
    hipW: 0.088 * k * (0.96 + 0.08 * b),
    pelvisAboveHip: 0.035 * k,
    upperArm: 0.29 * k,
    forearm: 0.255 * k,
    palm: 0.088 * k, // wrist -> knuckles
    heel: 0.068 * k, // ankle -> back of heel (shoe)
    toe: 0.212 * k, // ankle -> toe tip (shoe)
    armBind: 0.72, // A-pose arm angle from vertical (radians)
  };
  d.hipY = d.ankleH + d.shin + d.thigh;
  d.pelvisY = d.hipY + d.pelvisAboveHip;
  d.off = {
    pelvis: V(0, d.pelvisY, 0),
    spine: V(0, 0.105 * k, -0.012 * k),
    chest: V(0, 0.16 * k, -0.004 * k),
    neck: V(0, 0.215 * k, -0.024 * k),
    head: V(0, 0.105 * k, 0.018 * k),
    clavL: V(0.022 * k, 0.18 * k, -0.01 * k),
    clavR: V(-0.022 * k, 0.18 * k, -0.01 * k),
    upperArmL: V(0.156 * k * d.sw, 0.004 * k, -0.01 * k),
    upperArmR: V(-0.156 * k * d.sw, 0.004 * k, -0.01 * k),
    forearmL: V(0, -d.upperArm, 0),
    forearmR: V(0, -d.upperArm, 0),
    handL: V(0, -d.forearm, 0),
    handR: V(0, -d.forearm, 0),
    thighL: V(d.hipW, -d.pelvisAboveHip, 0.012 * k),
    thighR: V(-d.hipW, -d.pelvisAboveHip, 0.012 * k),
    shinL: V(0, -d.thigh, 0),
    shinR: V(0, -d.thigh, 0),
    footL: V(0, -d.shin, 0),
    footR: V(0, -d.shin, 0),
  };
  // head centre relative to the head bone (skull is ~0.236m tall)
  d.headC = V(0, 0.089 * k, 0.022 * k);
  d.headR = { x: 0.074 * k, y: 0.117 * k, z: 0.097 * k };
  return d;
}

export const PARENT = {
  pelvis: null, spine: 'pelvis', chest: 'spine', neck: 'chest', head: 'neck',
  clavL: 'chest', upperArmL: 'clavL', forearmL: 'upperArmL', handL: 'forearmL',
  clavR: 'chest', upperArmR: 'clavR', forearmR: 'upperArmR', handR: 'forearmR',
  thighL: 'pelvis', shinL: 'thighL', footL: 'shinL',
  thighR: 'pelvis', shinR: 'thighR', footR: 'shinR',
};

/** Builds the bone hierarchy in bind pose and its THREE.Skeleton. */
export function createRig(dims) {
  const bones = {};
  const list = [];
  for (const name of BONE_NAMES) {
    const b = new THREE.Bone();
    b.name = name;
    b.position.copy(dims.off[name]);
    bones[name] = b;
    list.push(b);
    if (PARENT[name]) bones[PARENT[name]].add(b);
  }
  bones.upperArmL.quaternion.setFromAxisAngle(V(0, 0, 1), dims.armBind);
  bones.upperArmR.quaternion.setFromAxisAngle(V(0, 0, 1), -dims.armBind);
  bones.pelvis.updateMatrixWorld(true);
  const bindWorld = {};
  const bindQuat = {};
  const bindPos = {};
  for (const name of BONE_NAMES) {
    const m = bones[name].matrixWorld.clone();
    bindWorld[name] = m;
    bindPos[name] = new THREE.Vector3().setFromMatrixPosition(m);
    bindQuat[name] = new THREE.Quaternion().setFromRotationMatrix(m);
  }
  const skeleton = new THREE.Skeleton(list);
  return { bones, list, skeleton, bindWorld, bindPos, bindQuat, dims, root: bones.pelvis };
}
