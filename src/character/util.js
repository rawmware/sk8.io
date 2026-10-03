// Small math helpers shared by the character modules: smoothing, springs, IK, basis construction.
import * as THREE from 'three';

export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const gauss = (d2, w) => Math.exp(-d2 / (w * w));

/** Frame-rate independent exponential smoothing toward a target. */
export function damp(cur, target, lambda, dt) {
  return cur + (target - cur) * (1 - Math.exp(-lambda * dt));
}
export function dampVec(v, target, lambda, dt) {
  return v.lerp(target, 1 - Math.exp(-lambda * dt));
}
export function dampAngle(cur, target, lambda, dt) {
  let d = target - cur;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return cur + d * (1 - Math.exp(-lambda * dt));
}

/** Damped scalar spring (semi-implicit Euler, sub-stepped for stability). */
export class Spring {
  constructor(x = 0, freq = 4, zeta = 1) {
    this.x = x;
    this.v = 0;
    this.freq = freq;
    this.zeta = zeta;
  }
  update(target, dt, force = 0) {
    const w = 2 * Math.PI * this.freq;
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = w * w * (target - this.x) - 2 * this.zeta * w * this.v + force;
      this.v += a * h;
      this.x += this.v * h;
    }
    return this.x;
  }
  reset(x = 0) {
    this.x = x;
    this.v = 0;
  }
}

/** Damped vector spring. */
export class Spring3 {
  constructor(freq = 4, zeta = 1) {
    this.x = new THREE.Vector3();
    this.v = new THREE.Vector3();
    this.freq = freq;
    this.zeta = zeta;
    this.init = false;
  }
  update(target, dt, force) {
    if (!this.init) {
      this.x.copy(target);
      this.v.set(0, 0, 0);
      this.init = true;
      return this.x;
    }
    const w = 2 * Math.PI * this.freq;
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const ax = w * w * (target.x - this.x.x) - 2 * this.zeta * w * this.v.x + (force ? force.x : 0);
      const ay = w * w * (target.y - this.x.y) - 2 * this.zeta * w * this.v.y + (force ? force.y : 0);
      const az = w * w * (target.z - this.x.z) - 2 * this.zeta * w * this.v.z + (force ? force.z : 0);
      this.v.x += ax * h;
      this.v.y += ay * h;
      this.v.z += az * h;
      this.x.addScaledVector(this.v, h);
    }
    return this.x;
  }
  reset() {
    this.init = false;
  }
}

const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();

/** Quaternion whose local +Y maps to yAxis and local +Z is as close as possible to zHint. */
export function quatFromYZ(yAxis, zHint, out) {
  _y.copy(yAxis).normalize();
  _z.copy(zHint).addScaledVector(_y, -zHint.dot(_y));
  if (_z.lengthSq() < 1e-10) {
    // pick any perpendicular
    _z.set(0, 0, 1).addScaledVector(_y, -_y.z);
    if (_z.lengthSq() < 1e-6) _z.set(1, 0, 0).addScaledVector(_y, -_y.x);
  }
  _z.normalize();
  _x.crossVectors(_y, _z);
  _m.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m);
}

/** Quaternion from local +Z -> zAxis, +Y close to yHint. */
export function quatFromZY(zAxis, yHint, out) {
  _z.copy(zAxis).normalize();
  _y.copy(yHint).addScaledVector(_z, -yHint.dot(_z));
  if (_y.lengthSq() < 1e-10) {
    _y.set(0, 1, 0).addScaledVector(_z, -_z.y);
    if (_y.lengthSq() < 1e-6) _y.set(1, 0, 0).addScaledVector(_z, -_z.x);
  }
  _y.normalize();
  _x.crossVectors(_y, _z);
  _m.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m);
}

const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
/**
 * Analytic two-bone IK. a = root joint, t = target, l1/l2 = bone lengths, pole = bend direction hint.
 * Writes the middle joint into outMid and the reached end into outEnd. Returns stretch ratio (>1 = out of reach).
 */
export function twoBoneIK(a, t, l1, l2, pole, outMid, outEnd) {
  _d.subVectors(t, a);
  let dist = _d.length();
  const want = dist;
  if (dist < 1e-6) {
    _d.set(0, -1, 0);
    dist = 1e-6;
  } else _d.divideScalar(dist);
  const maxD = (l1 + l2) * 0.9995;
  const minD = Math.abs(l1 - l2) + 1e-3;
  dist = clamp(dist, minD, maxD);
  const cosA = clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _p.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (_p.lengthSq() < 1e-10) {
    _p.set(0, 0, 1).addScaledVector(_d, -_d.z);
  }
  _p.normalize();
  outMid.copy(a).addScaledVector(_d, l1 * cosA).addScaledVector(_p, l1 * sinA);
  outEnd.copy(a).addScaledVector(_d, dist);
  return want / (l1 + l2);
}

export function hash01(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Seeded PRNG (mulberry32) so procedural details are stable across rebuilds. */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Catmull-Rom interpolation of numeric fields across keyed samples [{t, ...}] */
export function sampleKeys(keys, t, field) {
  const n = keys.length;
  if (t <= keys[0].t) return keys[0][field];
  if (t >= keys[n - 1].t) return keys[n - 1][field];
  let i = 0;
  while (i < n - 2 && t > keys[i + 1].t) i++;
  const k0 = keys[Math.max(0, i - 1)];
  const k1 = keys[i];
  const k2 = keys[i + 1];
  const k3 = keys[Math.min(n - 1, i + 2)];
  const u = (t - k1.t) / (k2.t - k1.t);
  const p0 = k0[field];
  const p1 = k1[field];
  const p2 = k2[field];
  const p3 = k3[field];
  // non-uniform tangents scaled by key spacing
  const dt1 = k2.t - k1.t;
  const m1 = k1 === k0 ? (p2 - p1) : ((p2 - p0) / (k2.t - k0.t)) * dt1;
  const m2 = k3 === k2 ? (p2 - p1) : ((p3 - p1) / (k3.t - k1.t)) * dt1;
  const u2 = u * u;
  const u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * p1 + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * p2 + (u3 - u2) * m2;
}
