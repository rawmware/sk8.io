// Object dropper catalog: every item is built once in local space (origin = footprint center on
// the ground, riders approach from -Z travelling +Z) and instanced per placement.
import * as THREE from 'three';
import { Builder, matFromPosYaw } from './builder.js';
import * as P from './pieces.js';
import { bankProfile } from './shapes.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const T = (x, y, z, yaw = 0) => matFromPosYaw(x, y, z, yaw);

export const CATALOG = [
  { id: 'kicker', name: 'Kicker', category: 'Ramps' },
  { id: 'launch', name: 'Launch Ramp', category: 'Ramps' },
  { id: 'quarter', name: 'Quarter Pipe', category: 'Ramps' },
  { id: 'wedge', name: 'Wedge Bank', category: 'Ramps' },
  { id: 'pyramid', name: 'Pyramid', category: 'Ramps' },
  { id: 'funbox', name: 'Funbox + Ledge', category: 'Ramps' },
  { id: 'flatbar', name: 'Flat Bar', category: 'Rails' },
  { id: 'roundrail', name: 'Round Rail', category: 'Rails' },
  { id: 'downrail', name: '3 Stair Down Rail', category: 'Rails' },
  { id: 'ledge', name: 'Ledge Box', category: 'Ledges' },
  { id: 'manualpad', name: 'Manual Pad', category: 'Ledges' },
  { id: 'jersey', name: 'Jersey Barrier', category: 'Ledges' },
  { id: 'bench', name: 'Bench', category: 'Street' },
  { id: 'picnic', name: 'Picnic Table', category: 'Street' },
  { id: 'cone', name: 'Traffic Cone', category: 'Props' },
  { id: 'trashcan', name: 'Trash Can', category: 'Props' },
];

export const PROP_IDS = { cone: 'cone', trashcan: 'trash' };

const BUILDERS = {
  kicker(b) {
    P.kicker(b, T(0, 0, 0), { h: 0.42, r: 2.0, width: 1.2, deck: 0.25 });
  },
  launch(b) {
    P.kicker(b, T(0, 0, 0), { h: 0.95, r: 2.6, width: 1.6, deck: 0.4 });
  },
  quarter(b) {
    const qp = { h: 1.5, r: 2.0, deck: 1.0, width: 3.0 };
    const depth = Math.sqrt(qp.r * qp.r - (qp.r - qp.h) ** 2) + qp.deck;
    P.quarterPipe(b, T(0, 0, -depth / 2), { ...qp, style: 'wood' });
  },
  wedge(b) {
    const bp = bankProfile(0.6, 25, 1.0, 0.2);
    const depth = bp.topZ + 0.5;
    P.bank(b, T(0, 0, -depth / 2), { h: 0.6, angle: 25, rBot: 1.0, rTop: 0.2, deck: 0.5, width: 2.0, mat: 'skatelite', surf: 'wood', deckMat: 'plywood', deckSurf: 'wood', sideMat: 'paintedWood' });
  },
  pyramid(b) {
    P.pyramid(b, T(0, 0, 0), { hx: 0.9, hz: 0.9, rc: 0.25, h: 0.7, angle: 26, rBot: 1.1, rTop: 0.25 });
  },
  funbox(b) {
    P.pyramid(b, T(0, 0, 0), { hx: 1.7, hz: 0.9, rc: 0.25, h: 0.5, angle: 22, rBot: 1.0, rTop: 0.2 });
    P.ledge(b, T(0, 0.5, 0.25, 0), { len: 2.6, h: 0.32, depth: 0.45, metal: true });
  },
  flatbar(b) {
    P.flatBar(b, T(0, 0, 0, Math.PI / 2), { len: 4, h: 0.3, square: true, mat: 'paintBlack' });
  },
  roundrail(b) {
    const r = 0.024;
    P.roundRail(b, T(0, 0, 0, Math.PI / 2), [V(-2.2, 0.55 - r, 0), V(2.2, 0.55 - r, 0)], {
      r,
      mat: 'paintRed',
      posts: [
        { x: -1.9, z: 0, yTop: 0.55 - r },
        { x: 0, z: 0, yTop: 0.55 - r },
        { x: 1.9, z: 0, yTop: 0.55 - r },
      ],
    });
  },
  downrail(b) {
    // access bank -> 0.48 platform -> 3 stairs down (+Z) with a kinked center rail
    const H = 0.48;
    const W = 2.4;
    const plat0 = -1.6;
    const plat1 = 0.4;
    const bp = bankProfile(H, 16, 1.4, 0.4);
    P.bank(b, T(0, 0, plat0 - bp.topZ), { h: H, angle: 16, rBot: 1.4, rTop: 0.4, deck: 0.2, width: W, mat: 'skatelite', surf: 'wood', deckMat: 'plywood', deckSurf: 'wood', sideMat: 'paintedWood' });
    b.add(P.boxMM(-W / 2, 0, plat0, W / 2, H, plat1), 'castConcrete', 'concrete');
    // stairs going up toward -Z start at z = plat1 + 0.64
    const sm = T(0, 0, plat1 + 0.64, Math.PI);
    P.stairs(b, sm, { n: 3, rise: 0.16, run: 0.32, width: W, topDeck: 0.2 });
    // rail (world-local): flat over platform, then down along stairs (+Z)
    const r = 0.026;
    const yT = (z) => 1.0 + 0.5 * (plat1 + 0.64 - z) * 1; // nosing+0.84 along the stairs
    const zk = plat1 + 0.12;
    const zEnd = plat1 + 0.64 + 0.55;
    const pts = [V(0, yT(zk) - r, plat0 + 0.3), V(0, yT(zk) - r, zk), V(0, yT(zEnd) - r, zEnd)];
    P.roundRail(b, T(0, 0, 0), pts, {
      r,
      mat: 'paintYellow',
      posts: [
        { x: 0, z: plat0 + 0.5, yTop: pts[0].y, yBase: H },
        { x: 0, z: zEnd - 0.2, yTop: yT(zEnd - 0.2) - r, yBase: 0 },
      ],
    });
  },
  ledge(b) {
    P.ledge(b, T(0, 0, 0, Math.PI / 2), { len: 3, h: 0.4, depth: 0.6, metal: true, mat: 'paintedWood', surf: 'wood', railKind: 'metal' });
  },
  manualpad(b) {
    P.manualPad(b, T(0, 0, 0, Math.PI / 2), { len: 3.5, w: 1.4, h: 0.18 });
  },
  jersey(b) {
    P.jerseyBarrier(b, T(0, 0, 0, Math.PI / 2), { len: 3.0 });
  },
  bench(b) {
    P.bench(b, T(0, 0, 0, Math.PI / 2), { len: 2.2 });
  },
  picnic(b) {
    P.picnicTable(b, T(0, 0, 0, Math.PI / 2));
  },
};

const templates = new Map();

export function getTemplate(id, M) {
  if (templates.has(id)) return templates.get(id);
  const fn = BUILDERS[id];
  if (!fn) return null;
  const b = new Builder();
  fn(b);
  const meshes = b.buildMeshes(M);
  const colliders = b.buildColliders(M.collider);
  const t = { meshes, colliders, rails: b.rails };
  templates.set(id, t);
  return t;
}

export function instantiate(t, matrix) {
  const group = new THREE.Group();
  group.matrixAutoUpdate = false;
  group.matrix.copy(matrix);
  for (const m of t.meshes) {
    const c = new THREE.Mesh(m.geometry, m.material);
    c.castShadow = m.castShadow;
    c.receiveShadow = m.receiveShadow;
    group.add(c);
  }
  group.updateMatrixWorld(true);
  const colliders = t.colliders.map((m) => {
    const c = new THREE.Mesh(m.geometry, m.material);
    c.userData.surface = m.userData.surface;
    c.matrixAutoUpdate = false;
    c.matrix.copy(matrix);
    c.updateMatrixWorld(true);
    c.name = m.name;
    return c;
  });
  const rails = t.rails.map((r) => ({ a: r.a.clone().applyMatrix4(matrix), b: r.b.clone().applyMatrix4(matrix), kind: r.kind, radius: r.radius }));
  return { group, colliders, rails };
}
