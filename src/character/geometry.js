// Procedural geometry toolkit: "parts" (vertex soup with skin weights) that are lofted, deformed, mirrored and
// finally merged into one BufferGeometry per mesh (one draw call per material).
import * as THREE from 'three';
import { MIRROR_BONE } from './rig.js';

export class Part {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.si = [];
    this.sw = [];
    this.idx = [];
    this.group = 0;
  }
  get count() {
    return this.pos.length / 3;
  }
  /** set all vertices to the same skin weights: [[boneIndex, weight], ...] */
  setWeights(w) {
    const n = this.count;
    this.si.length = 0;
    this.sw.length = 0;
    for (let i = 0; i < n; i++) pushWeights(this.si, this.sw, w);
    return this;
  }
  transform(m) {
    const v = new THREE.Vector3();
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    for (let i = 0; i < this.pos.length; i += 3) {
      v.set(this.pos[i], this.pos[i + 1], this.pos[i + 2]).applyMatrix4(m);
      this.pos[i] = v.x;
      this.pos[i + 1] = v.y;
      this.pos[i + 2] = v.z;
      if (this.nor.length) {
        v.set(this.nor[i], this.nor[i + 1], this.nor[i + 2]).applyMatrix3(nm).normalize();
        this.nor[i] = v.x;
        this.nor[i + 1] = v.y;
        this.nor[i + 2] = v.z;
      }
    }
    return this;
  }
  translate(x, y, z) {
    return this.transform(new THREE.Matrix4().makeTranslation(x, y, z));
  }
  clone() {
    const p = new Part();
    p.pos = this.pos.slice();
    p.nor = this.nor.slice();
    p.uv = this.uv.slice();
    p.si = this.si.slice();
    p.sw = this.sw.slice();
    p.idx = this.idx.slice();
    p.group = this.group;
    return p;
  }
  /** mirror across x = 0 (left <-> right), flipping winding and swapping L/R bone indices */
  mirrored() {
    const p = this.clone();
    for (let i = 0; i < p.pos.length; i += 3) {
      p.pos[i] = -p.pos[i];
      p.nor[i] = -p.nor[i];
    }
    for (let i = 0; i < p.idx.length; i += 3) {
      const t = p.idx[i + 1];
      p.idx[i + 1] = p.idx[i + 2];
      p.idx[i + 2] = t;
    }
    for (let i = 0; i < p.si.length; i++) p.si[i] = MIRROR_BONE[p.si[i]];
    return p;
  }
  /** mirror the U coordinate inside a [u0,u1] range (keeps texture handedness for mirrored limbs) */
  flipU(u0 = 0, u1 = 1) {
    for (let i = 0; i < this.uv.length; i += 2) this.uv[i] = u0 + u1 - this.uv[i];
    return this;
  }
  append(o) {
    const base = this.count;
    pushAll(this.pos, o.pos);
    pushAll(this.nor, o.nor);
    pushAll(this.uv, o.uv);
    pushAll(this.si, o.si);
    pushAll(this.sw, o.sw);
    for (let i = 0; i < o.idx.length; i++) this.idx.push(o.idx[i] + base);
    return this;
  }
}

function pushAll(a, b) {
  for (let i = 0; i < b.length; i++) a.push(b[i]);
}

export function pushWeights(si, sw, w) {
  // w: [[bone, weight], ...] up to 4, normalised here
  let tot = 0;
  for (let i = 0; i < w.length && i < 4; i++) tot += w[i][1];
  for (let i = 0; i < 4; i++) {
    if (i < w.length) {
      si.push(w[i][0]);
      sw.push(tot > 0 ? w[i][1] / tot : i === 0 ? 1 : 0);
    } else {
      si.push(0);
      sw.push(0);
    }
  }
}

/** blend two weight lists: (1-t)*a + t*b */
export function blendW(a, b, t) {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const m = new Map();
  for (const [i, w] of a) m.set(i, (m.get(i) || 0) + w * (1 - t));
  for (const [i, w] of b) m.set(i, (m.get(i) || 0) + w * t);
  return [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4);
}

/** smooth vertex normals: area weighted face normals, then averaged across vertices sharing a position */
export function computeNormals(part, smoothSeams = true) {
  const n = part.count;
  const nor = new Float32Array(n * 3);
  const P = part.pos;
  const I = part.idx;
  for (let f = 0; f < I.length; f += 3) {
    const a = I[f] * 3;
    const b = I[f + 1] * 3;
    const c = I[f + 2] * 3;
    const e1x = P[b] - P[a];
    const e1y = P[b + 1] - P[a + 1];
    const e1z = P[b + 2] - P[a + 2];
    const e2x = P[c] - P[a];
    const e2y = P[c + 1] - P[a + 1];
    const e2z = P[c + 2] - P[a + 2];
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    for (const v of [a, b, c]) {
      nor[v] += nx;
      nor[v + 1] += ny;
      nor[v + 2] += nz;
    }
  }
  if (smoothSeams) {
    const map = new Map();
    const q = 1e5;
    for (let i = 0; i < n; i++) {
      const key = `${Math.round(P[i * 3] * q)},${Math.round(P[i * 3 + 1] * q)},${Math.round(P[i * 3 + 2] * q)}`;
      let g = map.get(key);
      if (!g) map.set(key, (g = []));
      g.push(i);
    }
    for (const g of map.values()) {
      if (g.length < 2) continue;
      let x = 0;
      let y = 0;
      let z = 0;
      for (const i of g) {
        x += nor[i * 3];
        y += nor[i * 3 + 1];
        z += nor[i * 3 + 2];
      }
      for (const i of g) {
        nor[i * 3] = x;
        nor[i * 3 + 1] = y;
        nor[i * 3 + 2] = z;
      }
    }
  }
  part.nor = new Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = nor[i * 3];
    const y = nor[i * 3 + 1];
    const z = nor[i * 3 + 2];
    const l = Math.hypot(x, y, z) || 1;
    part.nor[i * 3] = x / l;
    part.nor[i * 3 + 1] = y / l;
    part.nor[i * 3 + 2] = z / l;
  }
  return part;
}

/** flip faces so normals point away from the part's centroid (or the given center) */
export function orientOutward(part, center) {
  const n = part.count;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  if (center) {
    cx = center.x;
    cy = center.y;
    cz = center.z;
  } else {
    for (let i = 0; i < n; i++) {
      cx += part.pos[i * 3];
      cy += part.pos[i * 3 + 1];
      cz += part.pos[i * 3 + 2];
    }
    cx /= n;
    cy /= n;
    cz /= n;
  }
  let s = 0;
  for (let i = 0; i < n; i++) {
    s +=
      part.nor[i * 3] * (part.pos[i * 3] - cx) +
      part.nor[i * 3 + 1] * (part.pos[i * 3 + 1] - cy) +
      part.nor[i * 3 + 2] * (part.pos[i * 3 + 2] - cz);
  }
  if (s < 0) flipPart(part);
  return part;
}

export function flipPart(part) {
  for (let i = 0; i < part.idx.length; i += 3) {
    const t = part.idx[i + 1];
    part.idx[i + 1] = part.idx[i + 2];
    part.idx[i + 2] = t;
  }
  for (let i = 0; i < part.nor.length; i++) part.nor[i] = -part.nor[i];
  return part;
}

/**
 * Generic grid surface. sample(i, j, o) must set o.p (Vector3), o.u, o.v and optionally o.w (weights).
 * i in [0..nu], j in [0..nv]. Faces connect (i,j)-(i+1,j)-(i,j+1).
 */
export function gridPart(nu, nv, sample, opts = {}) {
  const part = new Part();
  const o = { p: new THREE.Vector3(), u: 0, v: 0, w: null };
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      o.w = null;
      sample(i, j, o);
      part.pos.push(o.p.x, o.p.y, o.p.z);
      part.uv.push(o.u, o.v);
      if (o.w) pushWeights(part.si, part.sw, o.w);
    }
  }
  const row = nu + 1;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * row + i;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      part.idx.push(a, c, b, b, c, d);
    }
  }
  computeNormals(part, opts.smooth !== false);
  if (opts.orient === 'flip') flipPart(part);
  else if (opts.orient !== 'none') orientOutward(part, opts.center);
  if (!part.si.length && opts.weights) part.setWeights(opts.weights);
  return part;
}

/**
 * Loft through rings. ring = { c: Vector3, ax: Vector3 (lateral unit), az: Vector3 (front unit),
 *   rx, rzF, rzB, pw (superellipse power, 2 = ellipse), w: weights, v?: number }
 * u = 0.5 is the ring front (+az), u = 0.25 is +ax. Seam at the back.
 */
export function tubePart(rings, nu, opts = {}) {
  const u0 = opts.u0 ?? 0;
  const u1 = opts.u1 ?? 1;
  const v0 = opts.v0 ?? 0;
  const v1 = opts.v1 ?? 1;
  // cumulative length for v
  const cum = [0];
  for (let j = 1; j < rings.length; j++) cum.push(cum[j - 1] + rings[j].c.distanceTo(rings[j - 1].c) + 1e-6);
  const total = cum[cum.length - 1] || 1;
  const disp = opts.disp;
  const part = gridPart(
    nu,
    rings.length - 1,
    (i, j, o) => {
      const r = rings[j];
      const th = -Math.PI / 2 + (2 * Math.PI * i) / nu;
      const c = Math.cos(th);
      const s = Math.sin(th);
      const pw = r.pw ?? 2;
      const e = 2 / pw;
      const X = Math.sign(c) * Math.pow(Math.abs(c), e);
      const Z = Math.sign(s) * Math.pow(Math.abs(s), e);
      let rx = r.rx;
      let rz = s > 0 ? r.rzF ?? r.rz ?? r.rx : r.rzB ?? r.rz ?? r.rx;
      let dr = 0;
      if (disp) dr = disp(th, j, r, i);
      o.p.copy(r.c).addScaledVector(r.ax, X * (rx + dr)).addScaledVector(r.az, Z * (rz + dr));
      o.u = u0 + ((u1 - u0) * i) / nu;
      o.v = r.v !== undefined ? r.v : v0 + ((v1 - v0) * cum[j]) / total;
      o.w = opts.wfn ? opts.wfn(th, j, r, X, Z) : r.w;
    },
    { orient: opts.orient ?? 'none', smooth: true, center: opts.center },
  );
  if (!opts.orient) {
    // rings run along the axis; ensure outward normals by checking the first interior ring
    const mid = Math.floor(rings.length / 2);
    const r = rings[mid];
    const k = (nu + 1) * mid + Math.floor(nu / 2); // front vertex of mid ring
    const nx = part.nor[k * 3];
    const ny = part.nor[k * 3 + 1];
    const nz = part.nor[k * 3 + 2];
    if (nx * r.az.x + ny * r.az.y + nz * r.az.z < 0) flipPart(part);
  }
  return part;
}

/** Deformed sphere: fn(dir, u, v, outPoint) maps a unit direction to a surface point.  u=0.5 is +Z. */
export function spherePart(nu, nv, fn, opts = {}) {
  const dir = new THREE.Vector3();
  const th0 = opts.thetaStart ?? 0;
  const th1 = opts.thetaEnd ?? Math.PI;
  const ph0 = opts.phiStart ?? -Math.PI;
  const ph1 = opts.phiEnd ?? Math.PI;
  return gridPart(
    nu,
    nv,
    (i, j, o) => {
      const th = th0 + ((th1 - th0) * j) / nv;
      const ph = ph0 + ((ph1 - ph0) * i) / nu;
      dir.set(Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph));
      o.u = opts.uvMap ? 0 : i / nu;
      o.v = 1 - j / nv;
      fn(dir, o.u, o.v, o.p, o);
    },
    { orient: opts.orient ?? 'auto', center: opts.center, weights: opts.weights },
  );
}

/** convert a THREE.BufferGeometry into a Part */
export function fromGeometry(geo, weights) {
  const g = geo.index ? geo : geo;
  const part = new Part();
  const p = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    part.pos.push(p.getX(i), p.getY(i), p.getZ(i));
    part.uv.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
  }
  if (g.index) for (let i = 0; i < g.index.count; i++) part.idx.push(g.index.getX(i));
  else for (let i = 0; i < p.count; i++) part.idx.push(i);
  if (g.attributes.normal) {
    const n = g.attributes.normal;
    for (let i = 0; i < n.count; i++) part.nor.push(n.getX(i), n.getY(i), n.getZ(i));
  } else computeNormals(part);
  if (weights) part.setWeights(weights);
  geo.dispose();
  return part;
}

/** Ellipsoid / capsule-ish helper in local space. */
export function ellipsoidPart(rx, ry, rz, nu = 16, nv = 12, weights) {
  return spherePart(nu, nv, (d, u, v, out) => out.set(d.x * rx, d.y * ry, d.z * rz), { weights });
}

/** Tube following a polyline/curve of points with a radius function. */
export function pathTubePart(points, radiusFn, nu = 8, opts = {}) {
  const rings = [];
  const n = points.length;
  let prevAx = null;
  for (let j = 0; j < n; j++) {
    const a = points[Math.max(0, j - 1)];
    const b = points[Math.min(n - 1, j + 1)];
    const t = new THREE.Vector3().subVectors(b, a).normalize();
    let ax;
    if (prevAx) ax = prevAx.clone().addScaledVector(t, -prevAx.dot(t)).normalize();
    else {
      ax = new THREE.Vector3(1, 0, 0);
      if (Math.abs(t.x) > 0.9) ax.set(0, 0, 1);
      ax.addScaledVector(t, -ax.dot(t)).normalize();
    }
    prevAx = ax;
    const az = new THREE.Vector3().crossVectors(ax, t).normalize();
    const r = radiusFn(j / (n - 1), j);
    rings.push({ c: points[j].clone(), ax, az, rx: r, rzF: r, rzB: r, w: opts.w ? opts.w(j / (n - 1)) : undefined });
  }
  const part = tubePart(rings, nu, { ...opts, orient: 'none' });
  // orientation: make the normal at a mid vertex point away from the path
  const mid = Math.floor(n / 2);
  const k = (nu + 1) * mid;
  const px = part.pos[k * 3] - points[mid].x;
  const py = part.pos[k * 3 + 1] - points[mid].y;
  const pz = part.pos[k * 3 + 2] - points[mid].z;
  if (px * part.nor[k * 3] + py * part.nor[k * 3 + 1] + pz * part.nor[k * 3 + 2] < 0) flipPart(part);
  if (opts.weights) part.setWeights(opts.weights);
  return part;
}

/** Merge parts (sorted by group) into a BufferGeometry. */
export function buildGeometry(parts, skinned) {
  parts = parts.filter((p) => p && p.count);
  parts.sort((a, b) => a.group - b.group);
  let nv = 0;
  let ni = 0;
  for (const p of parts) {
    nv += p.count;
    ni += p.idx.length;
  }
  const pos = new Float32Array(nv * 3);
  const nor = new Float32Array(nv * 3);
  const uv = new Float32Array(nv * 2);
  const si = skinned ? new Uint16Array(nv * 4) : null;
  const sw = skinned ? new Float32Array(nv * 4) : null;
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  const geo = new THREE.BufferGeometry();
  let vo = 0;
  let io = 0;
  let curGroup = null;
  let groupStart = 0;
  for (const p of parts) {
    if (curGroup !== null && p.group !== curGroup) {
      geo.addGroup(groupStart, io - groupStart, curGroup);
      groupStart = io;
    }
    curGroup = p.group;
    pos.set(p.pos, vo * 3);
    nor.set(p.nor, vo * 3);
    uv.set(p.uv, vo * 2);
    if (skinned) {
      if (p.si.length !== p.count * 4) throw new Error('part missing skin weights');
      si.set(p.si, vo * 4);
      sw.set(p.sw, vo * 4);
    }
    for (let i = 0; i < p.idx.length; i++) idx[io + i] = p.idx[i] + vo;
    vo += p.count;
    io += p.idx.length;
  }
  if (curGroup !== null) geo.addGroup(groupStart, io - groupStart, curGroup);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (skinned) {
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  }
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  return geo;
}

/** Interpolate keyed profile samples into n+1 evenly spaced samples (Catmull-Rom per numeric field). */
export function resampleKeys(keys, n, sampleFn) {
  const out = [];
  const t0 = keys[0].t;
  const t1 = keys[keys.length - 1].t;
  for (let j = 0; j <= n; j++) {
    const t = t0 + ((t1 - t0) * j) / n;
    out.push(sampleFn(t));
  }
  return out;
}
