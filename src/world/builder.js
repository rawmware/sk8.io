// Geometry accumulation + merging. Visual geometry is merged per material, collider geometry
// per surface. All UVs are in meters.
import * as THREE from 'three';

const _v = new THREE.Vector3();

// ---------- Low-level indexed mesh writer ----------
export class Geo {
  constructor(withColor = false) {
    this.p = [];
    this.n = [];
    this.uv = [];
    this.c = withColor ? [] : null;
    this.idx = [];
  }
  get count() {
    return this.p.length / 3;
  }
  vert(x, y, z, nx, ny, nz, u, v, col) {
    this.p.push(x, y, z);
    this.n.push(nx, ny, nz);
    this.uv.push(u, v);
    if (this.c) this.c.push(col ? col[0] : 1, col ? col[1] : 1, col ? col[2] : 1);
    return this.p.length / 3 - 1;
  }
  tri(a, b, c) {
    this.idx.push(a, b, c);
  }
  // triangle with winding fixed so its face normal agrees with (hx,hy,hz)
  triO(a, b, c, hx, hy, hz) {
    const p = this.p;
    const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2];
    const e1x = p[b * 3] - ax, e1y = p[b * 3 + 1] - ay, e1z = p[b * 3 + 2] - az;
    const e2x = p[c * 3] - ax, e2y = p[c * 3 + 1] - ay, e2z = p[c * 3 + 2] - az;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    if (nx * hx + ny * hy + nz * hz < 0) this.idx.push(a, c, b);
    else this.idx.push(a, b, c);
  }
  // quad a-b-c-d (in order around), oriented to hint normal
  quadO(a, b, c, d, hx, hy, hz) {
    this.triO(a, b, c, hx, hy, hz);
    this.triO(a, c, d, hx, hy, hz);
  }
  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.c) g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.idx);
    return g;
  }
}

// Planar (box) projection UVs in meters, by dominant normal axis.
export function planarUV(g, scale = 1) {
  const p = g.attributes.position;
  const n = g.attributes.normal;
  let uv = g.attributes.uv;
  if (!uv) {
    uv = new THREE.Float32BufferAttribute(new Float32Array(p.count * 2), 2);
    g.setAttribute('uv', uv);
  }
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    const az = Math.abs(n.getZ(i));
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    if (ay >= ax && ay >= az) uv.setXY(i, x * scale, z * scale);
    else if (ax >= az) uv.setXY(i, z * scale, y * scale);
    else uv.setXY(i, x * scale, y * scale);
  }
  uv.needsUpdate = true;
  return g;
}

function ensureIndex(g) {
  if (!g.index) {
    const n = g.attributes.position.count;
    const a = new Array(n);
    for (let i = 0; i < n; i++) a[i] = i;
    g.setIndex(a);
  }
  return g;
}

// Merge geometries (concatenating the listed attributes). Missing uv -> 0, color -> 1.
export function mergeGeos(list, attrs = ['position', 'normal', 'uv']) {
  let nv = 0;
  let ni = 0;
  for (const g of list) {
    ensureIndex(g);
    nv += g.attributes.position.count;
    ni += g.index.count;
  }
  const out = new THREE.BufferGeometry();
  const sizes = { position: 3, normal: 3, uv: 2, color: 3 };
  for (const a of attrs) {
    const sz = sizes[a];
    const arr = new Float32Array(nv * sz);
    let o = 0;
    for (const g of list) {
      const src = g.attributes[a];
      const cnt = g.attributes.position.count;
      if (src) {
        if (src.isInterleavedBufferAttribute || src.itemSize !== sz) {
          for (let i = 0; i < cnt; i++) for (let k = 0; k < sz; k++) arr[o + i * sz + k] = src.getComponent(i, k);
        } else arr.set(src.array.subarray(0, cnt * sz), o);
      } else if (a === 'color') arr.fill(1, o, o + cnt * sz);
      o += cnt * sz;
    }
    out.setAttribute(a, new THREE.BufferAttribute(arr, sz));
  }
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0;
  let io = 0;
  for (const g of list) {
    const src = g.index.array;
    for (let i = 0; i < g.index.count; i++) idx[io + i] = src[i] + vo;
    io += g.index.count;
    vo += g.attributes.position.count;
  }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

export function matFromPosYaw(x, y, z, yaw = 0) {
  const m = new THREE.Matrix4().makeRotationY(yaw);
  m.setPosition(x, y, z);
  return m;
}

// ---------- High level builder ----------
export class Builder {
  constructor() {
    this.vis = new Map(); // key -> { mat, cast, receive, geos: [] }
    this.col = new Map(); // surface -> geos
    this.rails = [];
    this.matrix = null; // optional global transform applied to everything added
  }
  _xf(g, matrix) {
    if (matrix) g.applyMatrix4(matrix);
    if (this.matrix) g.applyMatrix4(this.matrix);
    return g;
  }
  // geom is consumed (transformed in place). surf: collider surface or null.
  add(geom, mat, surf = null, opts = {}) {
    const { matrix = null, cast = true, receive = true, worldUV = false, uvScale = 1, colliderOnly = false } = opts;
    const g = this._xf(geom, matrix);
    if (worldUV) planarUV(g, uvScale);
    if (!colliderOnly) {
      const key = `${mat}|${cast ? 1 : 0}|${receive ? 1 : 0}`;
      let e = this.vis.get(key);
      if (!e) {
        e = { mat, cast, receive, geos: [] };
        this.vis.set(key, e);
      }
      e.geos.push(g);
    }
    if (surf) this._addCol(g, surf);
    return g;
  }
  _addCol(g, surf) {
    let arr = this.col.get(surf);
    if (!arr) this.col.set(surf, (arr = []));
    const c = new THREE.BufferGeometry();
    c.setAttribute('position', g.attributes.position.clone());
    if (g.index) c.setIndex(g.index.clone());
    arr.push(c);
  }
  // collider-only geometry (invisible)
  collider(geom, surf, matrix = null) {
    const g = this._xf(geom, matrix);
    if (!g.attributes.normal) g.computeVertexNormals();
    this._addCol(g, surf);
  }
  rail(a, b, kind, radius = 0.02, matrix = null) {
    const A = a.clone();
    const B = b.clone();
    if (matrix) {
      A.applyMatrix4(matrix);
      B.applyMatrix4(matrix);
    }
    if (this.matrix) {
      A.applyMatrix4(this.matrix);
      B.applyMatrix4(this.matrix);
    }
    if (A.distanceTo(B) < 1e-3) return;
    this.rails.push({ a: A, b: B, kind, radius });
  }
  // polyline rail (several straight segments)
  railPath(pts, kind, radius, matrix = null) {
    for (let i = 0; i < pts.length - 1; i++) this.rail(pts[i], pts[i + 1], kind, radius, matrix);
  }
  buildMeshes(materials) {
    const out = [];
    for (const e of this.vis.values()) {
      const geo = mergeGeos(e.geos, e.geos.some((g) => g.attributes.color) ? ['position', 'normal', 'uv', 'color'] : undefined);
      const mesh = new THREE.Mesh(geo, resolveMat(materials, e.mat));
      mesh.castShadow = e.cast;
      mesh.receiveShadow = e.receive;
      mesh.name = 'vis:' + e.mat;
      out.push(mesh);
    }
    return out;
  }
  buildColliders(material) {
    const out = [];
    for (const [surf, geos] of this.col) {
      const geo = mergeGeos(geos, ['position']);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, material);
      mesh.userData.surface = surf;
      mesh.name = 'col:' + surf;
      out.push(mesh);
    }
    return out;
  }
}

export function resolveMat(M, key) {
  if (typeof key !== 'string') return key;
  if (key.startsWith('mural')) return M.murals[+key.slice(5)] || M.murals[0];
  const m = M[key];
  if (!m) throw new Error('unknown material ' + key);
  return m;
}

export { _v };
