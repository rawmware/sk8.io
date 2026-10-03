import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

// Collision world: all static colliders are baked into one world-space BVH (fast raycasts),
// dropped objects get their own small BVHs so they can be added/removed cheaply.

const _ray = new THREE.Ray();
const _inv = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _tri = new THREE.Triangle();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _target = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };

function bakeMeshes(meshes) {
  // returns { geometry (world space, position only), surfaces: string[] per triangle }
  const positions = [];
  const surfaces = [];
  for (const m of meshes) {
    m.updateMatrixWorld(true);
    const g = m.geometry;
    const pos = g.attributes.position;
    const idx = g.index;
    const count = idx ? idx.count : pos.count;
    const surf = m.userData.surface || 'concrete';
    for (let i = 0; i < count; i += 3) {
      for (let k = 0; k < 3; k++) {
        const vi = idx ? idx.getX(i + k) : i + k;
        _v.fromBufferAttribute(pos, vi).applyMatrix4(m.matrixWorld);
        positions.push(_v.x, _v.y, _v.z);
      }
      surfaces.push(surf);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return { geometry, surfaces };
}

class BVHBody {
  constructor(meshes) {
    const { geometry, surfaces } = bakeMeshes(meshes);
    this.geometry = geometry;
    this.surfaces = surfaces;
    this.bvh = geometry.attributes.position.count ? new MeshBVH(geometry, { targetLeafSize: 8 }) : null;
    geometry.computeBoundingBox();
    this.box = geometry.boundingBox;
  }

  // MeshBVH re-sorts the index buffer, so faceIndex addresses index triples, not the original order.
  // Vertices are never shared (non-indexed source), so the original triangle id = vertex / 3.
  triangleId(faceIndex) {
    const idx = this.geometry.index;
    return idx ? Math.floor(idx.getX(faceIndex * 3) / 3) : faceIndex;
  }

  surfaceOf(faceIndex) {
    return this.surfaces[this.triangleId(faceIndex)];
  }

  faceNormal(faceIndex, target) {
    const pos = this.geometry.attributes.position;
    const idx = this.geometry.index;
    const i0 = idx ? idx.getX(faceIndex * 3) : faceIndex * 3;
    const i1 = idx ? idx.getX(faceIndex * 3 + 1) : faceIndex * 3 + 1;
    const i2 = idx ? idx.getX(faceIndex * 3 + 2) : faceIndex * 3 + 2;
    _a.fromBufferAttribute(pos, i0);
    _b.fromBufferAttribute(pos, i1);
    _c.fromBufferAttribute(pos, i2);
    _tri.set(_a, _b, _c);
    return _tri.getNormal(target);
  }

  dispose() {
    this.geometry.dispose();
  }
}

export class CollisionWorld {
  constructor() {
    this.static = null;
    this.dynamic = new Map(); // key -> BVHBody
  }

  setStatic(meshes) {
    this.static?.dispose();
    this.static = new BVHBody(meshes);
  }

  setDynamic(key, meshes) {
    this.removeDynamic(key);
    if (meshes && meshes.length) this.dynamic.set(key, new BVHBody(meshes));
  }

  removeDynamic(key) {
    const b = this.dynamic.get(key);
    if (b) {
      b.dispose();
      this.dynamic.delete(key);
    }
  }

  clearDynamic() {
    for (const k of [...this.dynamic.keys()]) this.removeDynamic(k);
  }

  *_bodies() {
    if (this.static?.bvh) yield this.static;
    for (const b of this.dynamic.values()) if (b.bvh) yield b;
  }

  // Returns the closest hit or null: { point, normal (facing the ray origin), distance, surface }
  raycast(origin, dir, far, out = null) {
    _ray.origin.copy(origin);
    _ray.direction.copy(dir);
    let best = null;
    let bestBody = null;
    for (const body of this._bodies()) {
      if (!_ray.intersectsBox(body.box) && !body.box.containsPoint(origin)) continue;
      const hit = body.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, far);
      if (hit && hit.distance <= far && (!best || hit.distance < best.distance)) {
        best = hit;
        bestBody = body;
      }
    }
    if (!best) return null;
    const res = out || { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: 'concrete' };
    res.point.copy(best.point);
    bestBody.faceNormal(best.faceIndex, res.normal);
    if (res.normal.dot(dir) > 0) res.normal.negate();
    res.distance = best.distance;
    res.surface = bestBody.surfaceOf(best.faceIndex);
    return res;
  }

  // Sphere vs world: returns null or { normal, depth } (push-out direction) for ragdolls & props.
  sphere(center, radius) {
    let result = null;
    for (const body of this._bodies()) {
      const b = body.box;
      if (center.x < b.min.x - radius || center.x > b.max.x + radius || center.y < b.min.y - radius || center.y > b.max.y + radius || center.z < b.min.z - radius || center.z > b.max.z + radius) continue;
      const hit = body.bvh.closestPointToPoint(center, _target, 0, radius * 1.5);
      if (!hit) continue;
      body.faceNormal(_target.faceIndex, _n);
      _v.subVectors(center, _target.point);
      const d = _v.length();
      const behind = _v.dot(_n) < 0;
      let depth, normal;
      if (behind) {
        depth = radius + d;
        normal = _n.clone();
      } else {
        if (d >= radius) continue;
        depth = radius - d;
        normal = d > 1e-5 ? _v.clone().divideScalar(d) : _n.clone();
      }
      if (!result || depth > result.depth) result = { normal, depth };
    }
    return result;
  }
}
