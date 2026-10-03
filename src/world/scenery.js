// Ambient scenery: fence, trees, buildings with murals, outer ground, distant hills & skyline.
import * as THREE from 'three';
import { Geo, matFromPosYaw, mergeGeos } from './builder.js';
import { boxMM, cylinderBetween, flatPolygon } from './shapes.js';
import { mulberry32, makeNoise2D } from './noise.js';
import { PARK, HILL, hillY, edgeHeight } from './park.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const FENCE = PARK + 0.3;

// ---------------- fence ----------------
function buildFence(b) {
  const G = new Geo();
  const sides = [
    [V(-FENCE, 0, -FENCE), V(FENCE, 0, -FENCE)],
    [V(FENCE, 0, -FENCE), V(FENCE, 0, FENCE)],
    [V(FENCE, 0, FENCE), V(-FENCE, 0, FENCE)],
    [V(-FENCE, 0, FENCE), V(-FENCE, 0, -FENCE)],
  ];
  const topAt = (x, z) => Math.max(3.6, edgeHeight(Math.max(-PARK, Math.min(PARK, x)), Math.max(-PARK, Math.min(PARK, z))) + 2.6);
  let along = 0;
  for (const [A, B] of sides) {
    const len = A.distanceTo(B);
    const n = Math.ceil(len / 3);
    const dir = B.clone().sub(A).normalize();
    const nrm = V(-dir.z, 0, dir.x);
    let prevTop = null;
    let prevP = null;
    for (let i = 0; i <= n; i++) {
      const p = A.clone().addScaledVector(dir, (len * i) / n);
      const top = topAt(p.x, p.z);
      const corner = i === 0 || i === n;
      b.add(cylinderBetween(p, V(p.x, top + 0.05, p.z), corner ? 0.06 : 0.04, 8, true), 'galvanized', null);
      if (prevP) {
        // chain-link panel
        const a = G.vert(prevP.x, 0.04, prevP.z, nrm.x, 0, nrm.z, along, 0.04);
        const segLen = prevP.distanceTo(p);
        G.vert(p.x, 0.04, p.z, nrm.x, 0, nrm.z, along + segLen, 0.04);
        G.vert(p.x, top, p.z, nrm.x, 0, nrm.z, along + segLen, top);
        G.vert(prevP.x, prevTop, prevP.z, nrm.x, 0, nrm.z, along, prevTop);
        G.quadO(a, a + 1, a + 2, a + 3, nrm.x, 0, nrm.z);
        along += segLen;
        // top rail
        b.add(cylinderBetween(V(prevP.x, prevTop, prevP.z), V(p.x, top, p.z), 0.025, 6, false), 'galvanized', null, { cast: false });
      }
      prevP = p;
      prevTop = top;
    }
  }
  b.add(G.toGeometry(), 'chainLink', null, { cast: false });
  // invisible collider walls just inside the fence line
  const T = 1.0;
  const y0 = -3, y1 = 16;
  b.collider(boxMM(-PARK - T, y0, -PARK - T, PARK + T, y1, -PARK), 'concrete');
  b.collider(boxMM(-PARK - T, y0, PARK, PARK + T, y1, PARK + T), 'concrete');
  b.collider(boxMM(-PARK - T, y0, -PARK, -PARK, y1, PARK), 'concrete');
  b.collider(boxMM(PARK, y0, -PARK, PARK + T, y1, PARK), 'concrete');
}

// ---------------- outer ground, roads ----------------
function square(h) {
  return [
    [-h, -h],
    [h, -h],
    [h, h],
    [-h, h],
  ];
}
function buildOuterGround(b) {
  b.add(flatPolygon(square(88), [square(PARK)], 0), 'castConcrete', null, { cast: false });
  b.add(flatPolygon(square(97), [square(88)], 0), 'asphalt', null, { cast: false });
  b.add(flatPolygon(square(1600), [square(97)], 0), 'grass', null, { cast: false });
  // road center line
  const mk = (x0, z0, x1, z1) => b.add(boxMM(x0, 0, z0, x1, 0.004, z1), 'roadPaintYellow', null, { cast: false });
  mk(-92.6, -92.5, -92.4, 92.5);
  mk(92.4, -92.5, 92.6, 92.5);
  mk(-92.5, -92.6, 92.5, -92.4);
  mk(-92.5, 92.4, 92.5, 92.6);
}

// ---------------- buildings ----------------
function windowsOnFace(b, A, B, h, { floorH = 3.6, winW = 1.6, winH = 1.9, spacing = 3.2, startY = 1.2, normal, inset = 0.03 }) {
  const dir = B.clone().sub(A);
  const len = dir.length();
  dir.normalize();
  const nW = Math.floor((len - 1) / spacing);
  const off = (len - (nW - 1) * spacing) / 2;
  for (let fy = startY; fy + winH < h - 0.8; fy += floorH) {
    for (let i = 0; i < nW; i++) {
      const c = A.clone().addScaledVector(dir, off + i * spacing).addScaledVector(normal, inset);
      const G = new Geo();
      const r = dir.clone().multiplyScalar(winW / 2);
      const p0 = c.clone().sub(r);
      const p1 = c.clone().add(r);
      const a = G.vert(p0.x, fy, p0.z, normal.x, 0, normal.z, 0, 0);
      G.vert(p1.x, fy, p1.z, normal.x, 0, normal.z, 1, 0);
      G.vert(p1.x, fy + winH, p1.z, normal.x, 0, normal.z, 1, 1);
      G.vert(p0.x, fy + winH, p0.z, normal.x, 0, normal.z, 0, 1);
      G.quadO(a, a + 1, a + 2, a + 3, normal.x, 0, normal.z);
      b.add(G.toGeometry(), 'glass', null, { cast: false });
      // sill + lintel
      const s0 = p0.clone().addScaledVector(normal, -0.02);
      const s1 = p1.clone().addScaledVector(normal, 0.12);
      b.add(boxMM(Math.min(s0.x, s1.x) - 0.05, fy - 0.12, Math.min(s0.z, s1.z) - 0.05, Math.max(s0.x, s1.x) + 0.05, fy, Math.max(s0.z, s1.z) + 0.05), 'castConcrete', null, { cast: false });
      b.add(boxMM(Math.min(s0.x, s1.x) - 0.02, fy + winH, Math.min(s0.z, s1.z), Math.max(s0.x, s1.x) + 0.02, fy + winH + 0.12, Math.max(s0.z, s1.z)), 'windowFrame', null, { cast: false });
    }
  }
}

function building(b, { x0, z0, x1, z1, h, wall = 'brick', windows = false, murals = [], doors = [], rooftop = true, seed = 1 }) {
  const rand = mulberry32(seed);
  b.add(boxMM(x0, 0, z0, x1, h, z1), wall, null, { worldUV: true });
  // roof slab + parapet
  b.add(boxMM(x0 + 0.02, h, z0 + 0.02, x1 - 0.02, h + 0.05, z1 - 0.02), 'roof', null, { worldUV: true });
  const pT = 0.3;
  const pH = 0.7;
  const capMat = wall === 'brick' ? 'castConcrete' : 'darkSteel';
  b.add(boxMM(x0 - 0.05, h, z0 - 0.05, x1 + 0.05, h + pH, z0 + pT), capMat, null, { worldUV: true });
  b.add(boxMM(x0 - 0.05, h, z1 - pT, x1 + 0.05, h + pH, z1 + 0.05), capMat, null, { worldUV: true });
  b.add(boxMM(x0 - 0.05, h, z0, x0 + pT, h + pH, z1), capMat, null, { worldUV: true });
  b.add(boxMM(x1 - pT, h, z0, x1 + 0.05, h + pH, z1), capMat, null, { worldUV: true });
  // base plinth
  b.add(boxMM(x0 - 0.06, 0, z0 - 0.06, x1 + 0.06, 0.5, z1 + 0.06), 'darkConcrete', null, { worldUV: true });
  if (rooftop) {
    for (let i = 0; i < 4; i++) {
      const cx = x0 + 3 + rand() * (x1 - x0 - 6);
      const cz = z0 + 3 + rand() * (z1 - z0 - 6);
      const w = 1.5 + rand() * 2.5;
      const d = 1.2 + rand() * 2;
      b.add(boxMM(cx - w / 2, h, cz - d / 2, cx + w / 2, h + 1 + rand() * 1.2, cz + d / 2), 'galvanized', null);
    }
  }
  const faces = {
    // [A, B, outward normal]
    w: [V(x0, 0, z1), V(x0, 0, z0), V(-1, 0, 0)],
    e: [V(x1, 0, z0), V(x1, 0, z1), V(1, 0, 0)],
    s: [V(x0, 0, z0), V(x1, 0, z0), V(0, 0, -1)],
    n: [V(x1, 0, z1), V(x0, 0, z1), V(0, 0, 1)],
  };
  if (windows) {
    for (const k of Object.keys(faces)) {
      if (murals.some((m) => m.side === k)) continue;
      const [A, B, n] = faces[k];
      windowsOnFace(b, A, B, h, { normal: n, ...(typeof windows === 'object' ? windows : {}) });
    }
  }
  for (const m of murals) {
    const [A, B, n] = faces[m.side];
    const dir = B.clone().sub(A);
    const len = dir.length();
    dir.normalize();
    const w = Math.min(m.width ?? len - 2, len - 1, (h - (m.y0 ?? 0.6) - 0.35) * 2);
    const hh = w / 2;
    const c = A.clone().addScaledVector(dir, m.at ?? len / 2).addScaledVector(n, 0.02);
    const y0 = m.y0 ?? 0.6;
    const G = new Geo();
    // u must increase toward the viewer's right (viewer looks along -n)
    const right = n.clone().negate().cross(V(0, 1, 0));
    const rdir = dir.dot(right) >= 0 ? dir : dir.clone().negate();
    const r = rdir.clone().multiplyScalar(w / 2);
    const p0 = c.clone().sub(r);
    const p1 = c.clone().add(r);
    const a = G.vert(p0.x, y0, p0.z, n.x, 0, n.z, 0, 0);
    G.vert(p1.x, y0, p1.z, n.x, 0, n.z, 1, 0);
    G.vert(p1.x, y0 + hh, p1.z, n.x, 0, n.z, 1, 1);
    G.vert(p0.x, y0 + hh, p0.z, n.x, 0, n.z, 0, 1);
    G.quadO(a, a + 1, a + 2, a + 3, n.x, 0, n.z);
    b.add(G.toGeometry(), 'mural' + m.idx, null, { cast: false });
  }
  for (const d of doors) {
    const [A, B, n] = faces[d.side];
    const dir = B.clone().sub(A).normalize();
    const c = A.clone().addScaledVector(dir, d.at).addScaledVector(n, 0.05);
    const r = dir.clone().multiplyScalar(d.w / 2);
    const p0 = c.clone().sub(r);
    const p1 = c.clone().add(r).addScaledVector(n, 0.08);
    b.add(boxMM(Math.min(p0.x, p1.x), 0, Math.min(p0.z, p1.z), Math.max(p0.x, p1.x), d.h, Math.max(p0.z, p1.z)), d.mat || 'corrugated', null, { worldUV: true });
  }
}

function buildBuildings(b) {
  // west warehouse with mural facing the park
  building(b, {
    x0: -136, z0: -34, x1: -106, z1: 20, h: 10, wall: 'corrugatedCream', rooftop: true, seed: 3,
    murals: [{ side: 'e', idx: 0, width: 17, y0: 0.8 }],
    doors: [{ side: 'n', at: 12, w: 5, h: 5.2, mat: 'corrugated' }],
  });
  // south brick block with mural
  building(b, {
    x0: -44, z0: -138, x1: 2, z1: -106, h: 15, wall: 'brick', windows: true, seed: 5,
    murals: [{ side: 'n', idx: 1, width: 26, y0: 1.0 }],
  });
  building(b, { x0: 12, z0: -132, x1: 46, z1: -108, h: 22, wall: 'brick', windows: true, seed: 6 });
  // east warehouse (blue) with mural
  building(b, {
    x0: 106, z0: -52, x1: 140, z1: -8, h: 9, wall: 'corrugated', rooftop: true, seed: 7,
    murals: [{ side: 'w', idx: 2, width: 15.5, y0: 0.6 }],
    doors: [{ side: 'w', at: 37, w: 4.5, h: 4.6, mat: 'darkSteel' }],
  });
  building(b, { x0: 107, z0: 6, x1: 132, z1: 52, h: 18, wall: 'brick', windows: true, seed: 8 });
  // north side (behind the hill)
  building(b, { x0: -70, z0: 104, x1: -30, z1: 128, h: 13, wall: 'brick', windows: true, seed: 9 });
  building(b, { x0: 16, z0: 102, x1: 58, z1: 132, h: 9, wall: 'corrugatedRust', rooftop: true, seed: 10, doors: [{ side: 's', at: 20, w: 6, h: 5.5, mat: 'darkSteel' }] });
  building(b, { x0: -136, z0: 40, x1: -108, z1: 80, h: 11, wall: 'corrugatedRust', seed: 11 });
  building(b, { x0: 108, z0: 66, x1: 144, z1: 100, h: 26, wall: 'brick', windows: true, seed: 12 });
  building(b, { x0: -144, z0: -110, x1: -108, z1: -72, h: 16, wall: 'brick', windows: true, seed: 13 });
  building(b, { x0: 66, z0: -140, x1: 108, z1: -108, h: 12, wall: 'corrugatedCream', seed: 14 });
}

// ---------------- signage ----------------
function buildSign(b) {
  // park sign on two posts near the north-east entrance
  const x = 44, z = 57.5, y0 = 1.4, w = 4.0, h = 2.0;
  const G = new Geo();
  const a = G.vert(x - w / 2, y0, z + 0.06, 0, 0, -1, 1, 0);
  G.vert(x + w / 2, y0, z + 0.06, 0, 0, -1, 0, 0);
  G.vert(x + w / 2, y0 + h, z + 0.06, 0, 0, -1, 0, 1);
  G.vert(x - w / 2, y0 + h, z + 0.06, 0, 0, -1, 1, 1);
  G.quadO(a, a + 1, a + 2, a + 3, 0, 0, -1);
  // texture faces -Z (readable from the park): flip u so text isn't mirrored
  b.add(G.toGeometry(), 'sign', null, { cast: false });
  b.add(boxMM(x - w / 2 - 0.05, y0 - 0.05, z + 0.07, x + w / 2 + 0.05, y0 + h + 0.05, z + 0.16), 'darkSteel', null);
  for (const px of [x - w / 2 + 0.3, x + w / 2 - 0.3]) b.add(boxMM(px - 0.06, 0, z + 0.1, px + 0.06, y0 + h, z + 0.22), 'darkSteel', null);
}

// ---------------- trees (instanced) ----------------
function makeTree(seed, { height = 6, crown = 2.6, leafSize = 1.5, clusters = 34, bush = false } = {}) {
  const rand = mulberry32(seed);
  const trunk = [];
  const leaves = new Geo();
  const crownC = V(0, height * 0.68, 0);
  const tips = [];
  // trunk
  const lean = V((rand() - 0.5) * 0.4, 0, (rand() - 0.5) * 0.4);
  const tTop = V(lean.x, height * 0.55, lean.z);
  if (!bush) {
    trunk.push(cylinderBetween(V(0, -0.2, 0), V(lean.x * 0.5, height * 0.3, lean.z * 0.5), 0.2, 8, false, 0.16));
    trunk.push(cylinderBetween(V(lean.x * 0.5, height * 0.3, lean.z * 0.5), tTop, 0.16, 8, false, 0.12));
  }
  const grow = (p, dir, len, r, depth) => {
    const e = p.clone().addScaledVector(dir, len);
    if (!bush) trunk.push(cylinderBetween(p, e, r, depth >= 1 ? 5 : 3, false, r * 0.65));
    if (depth <= 0) {
      tips.push(e);
      return;
    }
    const nb = 2 + (rand() < 0.5 ? 1 : 0);
    for (let i = 0; i < nb; i++) {
      const d = dir.clone().add(V((rand() - 0.5) * 1.3, (rand() - 0.1) * 0.9, (rand() - 0.5) * 1.3)).normalize();
      grow(e, d, len * (0.6 + rand() * 0.2), r * 0.65, depth - 1);
    }
    if (rand() < 0.5) tips.push(e);
  };
  const nMain = 4 + Math.floor(rand() * 3);
  for (let i = 0; i < nMain; i++) {
    const a = (i / nMain) * Math.PI * 2 + rand() * 0.6;
    const dir = V(Math.cos(a), 0.7 + rand() * 0.6, Math.sin(a)).normalize();
    grow(tTop.clone(), dir, crown * (0.55 + rand() * 0.2), 0.11, 2);
  }
  // leaf clusters: around tips, plus fill inside the crown ellipsoid
  const centers = tips.slice();
  for (let i = 0; i < clusters; i++) {
    const u = rand() * Math.PI * 2;
    const v = Math.acos(2 * rand() - 1);
    const rr = Math.cbrt(rand()) * 0.85;
    centers.push(V(Math.sin(v) * Math.cos(u) * crown * rr, crownC.y + Math.cos(v) * crown * 0.75 * rr, Math.sin(v) * Math.sin(u) * crown * rr));
  }
  for (const c of centers) {
    const nq = 3;
    for (let q = 0; q < nq; q++) {
      const s = leafSize * (0.7 + rand() * 0.6);
      const nrm = V(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
      const t1 = V(0, 1, 0).cross(nrm);
      if (t1.lengthSq() < 0.01) t1.set(1, 0, 0);
      t1.normalize();
      const t2 = nrm.clone().cross(t1).normalize();
      const rot = rand() * Math.PI * 2;
      const r1 = t1.clone().multiplyScalar(Math.cos(rot)).addScaledVector(t2, Math.sin(rot));
      const r2 = nrm.clone().cross(r1).normalize();
      const off = V((rand() - 0.5) * 0.6, (rand() - 0.5) * 0.4, (rand() - 0.5) * 0.6);
      const ctr = c.clone().add(off);
      // shading normal: mostly radial from crown center (soft canopy lighting)
      const radial = ctr.clone().sub(crownC);
      radial.y *= 0.8;
      radial.normalize();
      const sn = radial.clone().multiplyScalar(0.8).addScaledVector(nrm, 0.2).normalize();
      const corners = [
        [-1, -1, 0, 0],
        [1, -1, 1, 0],
        [1, 1, 1, 1],
        [-1, 1, 0, 1],
      ];
      const base = leaves.count;
      const ao = 0.65 + 0.35 * Math.min(1, Math.max(0, (ctr.y - crownC.y) / crown + 0.6));
      for (const [sx, sy, u, vv] of corners) {
        const p = ctr.clone().addScaledVector(r1, (sx * s) / 2).addScaledVector(r2, (sy * s) / 2);
        leaves.vert(p.x, p.y, p.z, sn.x, sn.y, sn.z, u, vv, [ao, ao, ao]);
      }
      leaves.tri(base, base + 1, base + 2);
      leaves.tri(base, base + 2, base + 3);
    }
  }
  return { trunk: trunk.length ? mergeGeos(trunk) : null, leaves: leaves.toGeometry() };
}

function makeLeavesGeo(geo) {
  // add vertex color attr if missing
  if (!geo.attributes.color) {
    const c = new Float32Array(geo.attributes.position.count * 3).fill(1);
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
  return geo;
}

function buildTrees(group, M, spots) {
  const variants = [
    makeTree(11, { height: 7.5, crown: 3.0, leafSize: 2.0, clusters: 60 }),
    makeTree(23, { height: 9.5, crown: 2.7, leafSize: 1.9, clusters: 64 }),
    makeTree(37, { height: 5.0, crown: 2.0, leafSize: 1.6, clusters: 40 }),
    makeTree(51, { height: 0.9, crown: 0.75, leafSize: 0.85, clusters: 16, bush: true }),
  ];
  const leafMat = M.leaves.clone();
  leafMat.vertexColors = true;
  const per = variants.map(() => []);
  const rand = mulberry32(5);
  for (const s of spots) {
    const vi = s.variant ?? Math.floor(rand() * 3);
    per[vi].push(s);
  }
  const dummy = new THREE.Object3D();
  const inside = (p) => Math.abs(p.x) < 92 && Math.abs(p.z) < 92;
  variants.forEach((v, vi) => {
    for (const cast of [true, false]) {
      const list = per[vi].filter((s) => inside(s.pos) === cast);
      if (!list.length) continue;
      const meshes = [];
      if (v.trunk) meshes.push(new THREE.InstancedMesh(v.trunk, M.bark, list.length));
      meshes.push(new THREE.InstancedMesh(makeLeavesGeo(v.leaves), leafMat, list.length));
      list.forEach((s, i) => {
        dummy.position.copy(s.pos);
        dummy.rotation.set(0, s.rot ?? rand() * Math.PI * 2, 0);
        dummy.scale.setScalar(s.scale ?? 0.85 + rand() * 0.35);
        dummy.updateMatrix();
        for (const m of meshes) m.setMatrixAt(i, dummy.matrix);
      });
      for (const m of meshes) {
        m.castShadow = cast;
        m.receiveShadow = true;
        m.computeBoundingSphere();
        m.name = `trees:${vi}:${cast ? 'in' : 'out'}`;
        group.add(m);
      }
    }
  });
}

function treeSpots(parkTrees) {
  const rand = mulberry32(77);
  const spots = [];
  for (const p of parkTrees) spots.push(p.isVector3 ? { pos: p, variant: 2, scale: 0.8 + rand() * 0.2 } : p);
  // berm on the hill
  for (let x = -80; x < 8; x += 7 + rand() * 5) spots.push({ pos: V(x, hillY(x) + 0.15, 80.5 + rand() * 3), variant: rand() < 0.5 ? 0 : 1 });
  // north-east grass strip
  for (let x = 16; x < 72; x += 8 + rand() * 6) spots.push({ pos: V(x, 0, 79 + rand() * 4) });
  // outside the fence (between road and buildings / open grass)
  const ring = (fixed, axis, from, to, step) => {
    for (let t = from; t < to; t += step * (0.7 + rand() * 0.6)) {
      const off = fixed + (rand() - 0.5) * 3;
      spots.push({ pos: axis === 'x' ? V(t, 0, off) : V(off, 0, t), scale: 0.9 + rand() * 0.5 });
    }
  };
  ring(-100.5, 'x', -95, 95, 11);
  ring(100.5, 'z', -95, 60, 12);
  ring(-100.5, 'z', -60, 95, 12);
  ring(100.5, 'x', -95, 95, 13);
  // scattered further out
  for (let i = 0; i < 40; i++) {
    const a = rand() * Math.PI * 2;
    const r = 150 + rand() * 120;
    spots.push({ pos: V(Math.cos(a) * r, 0, Math.sin(a) * r), scale: 1 + rand() * 0.6 });
  }
  // a few inside the park corners
  for (const [x, z] of [
    [-78, 54],
    [78, 54],
    [-78, -42],
    [-34, -82],
    [70, -48],
    [-68, 45],
  ])
    spots.push({ pos: V(x, 0, z) });
  return spots;
}

// ---------------- distant hills & skyline ----------------
function buildDistant(group, M) {
  const noise = makeNoise2D(17);
  const G = new Geo(true);
  const NA = 160;
  const NR = 10;
  const rIn = 520;
  const rOut = 1500;
  const col = new THREE.Color();
  for (let j = 0; j <= NR; j++) {
    const t = j / NR;
    const r = rIn + (rOut - rIn) * t;
    for (let i = 0; i <= NA; i++) {
      const a = (i / NA) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const ridge = noise.fbm(Math.cos(a) * 3 + 10, Math.sin(a) * 3 + t * 2, 5);
      const env = Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5);
      const y = Math.max(0, (ridge - 0.32) * 260) * env * (0.5 + 0.5 * t) - 2;
      col.setRGB(0.1 + ridge * 0.06, 0.14 + ridge * 0.06, 0.1 + ridge * 0.04);
      G.vert(x, y, z, 0, 1, 0, x * 0.01, z * 0.01, [col.r, col.g, col.b]);
    }
  }
  const row = NA + 1;
  for (let j = 0; j < NR; j++) for (let i = 0; i < NA; i++) {
    const a = j * row + i;
    G.quadO(a, a + 1, a + row + 1, a + row, 0, 1, 0);
  }
  const geo = G.toGeometry();
  geo.computeVertexNormals();
  const hills = new THREE.Mesh(geo, M.distant);
  hills.name = 'distantHills';
  hills.receiveShadow = false;
  group.add(hills);
  // skyline: clustered towers in the north-east
  const rand = mulberry32(3);
  const boxes = [];
  for (let i = 0; i < 70; i++) {
    const a = THREE.MathUtils.degToRad(20 + rand() * 70);
    const r = 420 + rand() * 220;
    const w = 14 + rand() * 30;
    const d = 14 + rand() * 30;
    const h = 25 + rand() * rand() * 170;
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(Math.sin(a) * r, h / 2, Math.cos(a) * r);
    const c = new Float32Array(g.attributes.position.count * 3);
    const shade = 0.16 + rand() * 0.1;
    for (let k = 0; k < c.length; k += 3) {
      c[k] = shade * 0.92;
      c[k + 1] = shade * 0.96;
      c[k + 2] = shade * 1.06;
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    boxes.push(g);
  }
  const sky = new THREE.Mesh(mergeGeos(boxes, ['position', 'normal', 'uv', 'color']), M.distant);
  sky.name = 'skyline';
  group.add(sky);
}

export function buildScenery(b, group, M, park) {
  buildFence(b);
  buildOuterGround(b);
  buildBuildings(b);
  buildSign(b);
  buildTrees(group, M, treeSpots([...park.trees, ...park.treeSpecs]));
  buildDistant(group, M);
}

export { FENCE };
void matFromPosYaw;
void HILL;
