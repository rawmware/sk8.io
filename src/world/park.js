// Static skatepark layout: ground, street plaza, transition zone, bowl, hill.
import * as THREE from 'three';
import { Geo, matFromPosYaw } from './builder.js';
import { boxMM, flatPolygon, roundedRect, sweep, curveRing, tubeAlong, qpProfile, cylinderBetween, dedupe, bankProfile } from './shapes.js';
import * as P from './pieces.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const PI = Math.PI;
const YAW_PX = PI / 2; // travel +X
const YAW_NX = -PI / 2; // travel -X
const YAW_PZ = 0; // travel +Z
const YAW_NZ = PI; // travel -Z

export const PARK = 85; // half extent of the rideable area

// ---------------- Hill ----------------
export const HILL = {
  H: 5.0,
  grade: 0.06,
  L: 6, // vertical curve length (smooth start/end)
  x1: 12, // bottom (meets ground)
  road: [63, 75],
  swalk: [60.5, 63],
  parapet: [60.1, 60.5],
  nwalk: [75, 77.5],
  berm: [77.5, PARK],
};
HILL.x0 = HILL.x1 - HILL.H / HILL.grade - HILL.L;

export function hillY(x) {
  const { H, grade: g, L, x0, x1 } = HILL;
  if (x <= x0) return H;
  if (x < x0 + L) return H - (g * (x - x0) ** 2) / (2 * L);
  if (x < x1 - L) return H - (g * L) / 2 - g * (x - x0 - L);
  if (x < x1) return (g * (x1 - x) ** 2) / (2 * L);
  return 0;
}
function hillSlope(x) {
  const { grade: g, L, x0, x1 } = HILL;
  if (x <= x0 || x >= x1) return 0;
  if (x < x0 + L) return (-g * (x - x0)) / L;
  if (x < x1 - L) return -g;
  return (-g * (x1 - x)) / L;
}

function hillXs(xa, xb, step = 0.5) {
  const xs = [];
  for (let x = xa; x < xb - 1e-6; x += step) xs.push(x);
  xs.push(xb);
  for (const k of [HILL.x0, HILL.x0 + HILL.L, HILL.x1 - HILL.L]) if (k > xa && k < xb) xs.push(k);
  xs.sort((a, b) => a - b);
  return dedupe(xs.map((x) => [x, 0])).map((p) => p[0]);
}

// top strip following hill profile: z in [z0,z1], y = hillY(x) + off
function hillStrip(b, xs, z0, z1, off, mat, surf, opts = {}) {
  const G = new Geo();
  for (const x of xs) {
    const y = (opts.yFn ? opts.yFn(x) : hillY(x)) + off;
    const s = opts.yFn ? 0 : hillSlope(x);
    const l = Math.hypot(s, 1);
    G.vert(x, y, z0, -s / l, 1 / l, 0, x, z0);
    G.vert(x, y, z1, -s / l, 1 / l, 0, x, z1);
  }
  for (let i = 0; i < xs.length - 1; i++) {
    const a = i * 2;
    G.quadO(a, a + 1, a + 3, a + 2, 0, 1, 0);
  }
  b.add(G.toGeometry(), mat, surf, { cast: opts.cast !== false, receive: true });
}

// vertical wall along x at z, from yb(x) to yt(x), facing nz
function hillWall(b, xs, z, yb, yt, nz, mat, surf) {
  const G = new Geo();
  for (const x of xs) {
    G.vert(x, yb(x), z, 0, 0, nz, x, yb(x));
    G.vert(x, yt(x), z, 0, 0, nz, x, yt(x));
  }
  for (let i = 0; i < xs.length - 1; i++) {
    const a = i * 2;
    G.quadO(a, a + 2, a + 3, a + 1, 0, 0, nz);
  }
  b.add(G.toGeometry(), mat, surf);
}

// four vertical walls of a block (no top/bottom), world-space UVs
function blockWalls(b, x0, z0, x1, z1, h, mat, surf, skip = []) {
  const G = new Geo();
  const faces = [
    ['s', [x0, z0], [x1, z0], 0, -1],
    ['e', [x1, z0], [x1, z1], 1, 0],
    ['n', [x1, z1], [x0, z1], 0, 1],
    ['w', [x0, z1], [x0, z0], -1, 0],
  ];
  for (const [k, A, B, nx, nz] of faces) {
    if (skip.includes(k)) continue;
    const ua = nx !== 0 ? A[1] : A[0];
    const ub = nx !== 0 ? B[1] : B[0];
    const a = G.vert(A[0], 0, A[1], nx, 0, nz, ua, 0);
    G.vert(B[0], 0, B[1], nx, 0, nz, ub, 0);
    G.vert(B[0], h, B[1], nx, 0, nz, ub, h);
    G.vert(A[0], h, A[1], nx, 0, nz, ua, h);
    G.quadO(a, a + 1, a + 2, a + 3, nx, 0, nz);
  }
  b.add(G.toGeometry(), mat, surf);
}

function endCap(b, x, z0, z1, y0, y1, nx, mat, surf) {
  const G = new Geo();
  const a = G.vert(x, y0, z0, nx, 0, 0, z0, y0);
  G.vert(x, y0, z1, nx, 0, 0, z1, y0);
  G.vert(x, y1, z1, nx, 0, 0, z1, y1);
  G.vert(x, y1, z0, nx, 0, 0, z0, y1);
  G.quadO(a, a + 1, a + 2, a + 3, nx, 0, 0);
  b.add(G.toGeometry(), mat, surf);
}

// polyline along the hill: coarse on the constant grade, fine on the vertical curves
function hillRailPts(xa, xb, off, z) {
  const pts = [];
  let x = xa;
  while (x < xb) {
    pts.push(V(x, hillY(x) + off, z));
    const inCurve = (x >= HILL.x0 - 0.01 && x < HILL.x0 + HILL.L) || (x >= HILL.x1 - HILL.L - 0.01 && x < HILL.x1);
    let step = inCurve ? 1.0 : 6;
    // don't step over a curve boundary
    for (const k of [HILL.x0, HILL.x0 + HILL.L, HILL.x1 - HILL.L, HILL.x1]) if (k > x + 1e-6 && k < x + step) step = k - x;
    x += step;
  }
  pts.push(V(xb, hillY(xb) + off, z));
  return pts;
}

function buildHill(b) {
  const xa = -PARK;
  const xb = HILL.x1;
  const xs = hillXs(xa, xb, 0.5);
  const [r0, r1] = HILL.road;
  hillStrip(b, xs, r0, r1, 0, 'asphalt', 'asphalt');
  // sidewalks
  for (const [z0, z1, curbZ, nz] of [
    [HILL.swalk[0], HILL.swalk[1], HILL.swalk[1], 1],
    [HILL.nwalk[0], HILL.nwalk[1], HILL.nwalk[0], -1],
  ]) {
    hillStrip(b, xs, z0, z1, 0.15, 'castConcrete', 'concrete');
    hillWall(b, xs, curbZ, (x) => hillY(x), (x) => hillY(x) + 0.15, nz, 'castConcrete', 'concrete');
    // curb edge rails (segments every ~6 m, finer on the curves)
    b.railPath(hillRailPts(xa + 0.4, xb - 0.05, 0.15, curbZ), 'concrete', 0.02);
    // curb-cut ramp at the bottom end
    const G = new Geo();
    const xe = xb + 1.4;
    const zA = Math.min(z0, z1), zB = Math.max(z0, z1);
    const sl = Math.hypot(0.15, 1.4);
    const a = G.vert(xb, 0.15, zA, 0.15 / sl, 1.4 / sl, 0, xb, zA);
    G.vert(xb, 0.15, zB, 0.15 / sl, 1.4 / sl, 0, xb, zB);
    G.vert(xe, 0, zB, 0.15 / sl, 1.4 / sl, 0, xe, zB);
    G.vert(xe, 0, zA, 0.15 / sl, 1.4 / sl, 0, xe, zA);
    G.quadO(a, a + 1, a + 2, a + 3, 0, 1, 0);
    b.add(G.toGeometry(), 'castConcrete', 'concrete');
    // little triangular side for the cut on the curb side
    const T = new Geo();
    const t0 = T.vert(xb, 0, curbZ, 0, 0, nz, xb, 0);
    T.vert(xb, 0.15, curbZ, 0, 0, nz, xb, 0.15);
    T.vert(xe, 0, curbZ, 0, 0, nz, xe, 0);
    T.triO(t0, t0 + 1, t0 + 2, 0, 0, nz);
    b.add(T.toGeometry(), 'castConcrete', 'concrete');
  }
  // north berm (grass) flush with the sidewalk
  hillStrip(b, xs, HILL.berm[0], HILL.berm[1], 0.15, 'grass', 'grass', { cast: false });
  endCap(b, xb, HILL.berm[0], HILL.berm[1], 0, 0.15, 1, 'castConcrete', 'grass');
  // north retaining face (outside the fence)
  hillWall(b, xs, HILL.berm[1], () => 0, (x) => hillY(x) + 0.15, 1, 'castConcrete', null);
  // south parapet + retaining wall
  const [p0, p1] = HILL.parapet;
  const xsP = xs.filter((x) => x <= xb);
  hillStrip(b, xsP, p0, p1, 0.62, 'castConcrete', 'concrete');
  hillWall(b, xsP, p1, (x) => hillY(x) + 0.15, (x) => hillY(x) + 0.62, 1, 'castConcrete', 'concrete');
  hillWall(b, xsP, p0, () => 0, (x) => hillY(x) + 0.62, -1, 'castConcrete', 'concrete');
  endCap(b, xb, p0, p1, 0, 0.62, 1, 'castConcrete', 'concrete');
  {
    b.railPath(hillRailPts(xa + 0.4, xb - 0.05, 0.62, p1), 'concrete', 0.02);
  }
  // west end face (behind fence)
  endCap(b, xa, HILL.parapet[0], HILL.berm[1], 0, HILL.H + 0.62, -1, 'castConcrete', 'concrete');
  // road markings
  const mark = (z, w, mat, dash) => {
    let x = xa + 2;
    const xEnd = 70;
    while (x < xEnd) {
      const xe = Math.min(xEnd, dash ? x + 3 : xEnd);
      const xsM = hillXs(x, xe, 0.5);
      hillStrip(b, xsM, z - w / 2, z + w / 2, 0.004, mat, null, { cast: false });
      x = dash ? x + 9 : xEnd;
    }
  };
  mark((r0 + r1) / 2 - 0.1, 0.1, 'roadPaintYellow', false);
  mark((r0 + r1) / 2 + 0.1, 0.1, 'roadPaintYellow', false);
  mark(r0 + 0.35, 0.12, 'roadPaint', false);
  mark(r1 - 0.35, 0.12, 'roadPaint', false);
  // storm drains along the curbs (visual)
  for (let x = -70; x < 10; x += 22) {
    for (const z of [r0 + 0.25, r1 - 0.25]) {
      const y = hillY(x) + 0.003;
      b.add(boxMM(x - 0.45, y, z - 0.22, x + 0.45, y + 0.004, z + 0.22), 'darkSteel', null, { cast: false });
    }
  }
}

// ---------------- Bowl ----------------
export const BOWL = { cx: -52, cz: -58, hx: 6.5, hz: 4.2, radii: [3.6, 2.4, 3.2, 2.0], depth: 2.4, r: 2.6 };

function buildBowl(b) {
  const { cx, cz, hx, hz, radii, depth, r } = BOWL;
  const base = roundedRect(hx, hz, radii, 28, 2.5);
  const curve = base.map((c) => ({ ...c, x: c.x + cx, z: c.z + cz }));
  const qp = qpProfile(depth, r, 0, 36);
  const D = qp.lipZ;
  const prof = qp.pts.map(([d, y]) => [d, y - depth]);
  // split at tile band (top 0.3 m)
  let jb = prof.findIndex(([, y]) => y > -0.3);
  if (jb < 1) jb = prof.length - 2;
  sweep(b, curve, prof, { mat: 'smoothConcrete', surf: 'smoothConcrete', j0: 0, j1: jb });
  sweep(b, curve, prof, { mat: 'poolTile', surf: 'tile', j0: jb, j1: prof.length - 1, vOrigin: 0 });
  // floor
  b.add(flatPolygon(curve.map((c) => [c.x, c.z]), [], -depth), 'smoothConcrete', 'smoothConcrete');
  // drain
  b.add(new THREE.CylinderGeometry(0.16, 0.16, 0.006, 16).translate(cx + 1.0, -depth + 0.003, cz), 'darkSteel', null, { cast: false });
  // coping: rounded tube slightly overhanging, + grind rails
  const ringC = curveRing(curve, D - 0.012, -0.035);
  b.add(tubeAlong(ringC, 0.045, 10, true), 'poolCoping', null, { cast: true });
  const ringR = curveRing(curve, D - 0.012, 0.01);
  for (let i = 0; i < ringR.length; i++) {
    b.rail(ringR[i], ringR[(i + 1) % ringR.length], 'coping', 0.045);
  }
  // deck hole contour for the ground
  const hole = curve.map((c) => [c.x + c.nx * D, c.z + c.nz * D]);
  return { hole, D };
}

// ---------------- Ground ----------------
function rect(x0, z0, x1, z1) {
  return [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ];
}

function buildGround(b, bowlHole) {
  const add = (poly, holes, mat, surf, visual = true) => {
    const g = flatPolygon(poly, holes, 0);
    if (visual) b.add(g, mat, surf, { cast: false });
    else b.collider(g, surf);
  };
  add(rect(-PARK, -PARK, PARK, -32), [bowlHole], 'concrete', 'concrete');
  add(rect(-PARK, -32, PARK, HILL.parapet[0]), [], 'concrete', 'concrete');
  add(rect(-PARK, HILL.parapet[0], HILL.x1, PARK), [], 'concrete', 'concrete', false);
  add(rect(HILL.x1, HILL.parapet[0], PARK, HILL.road[0]), [], 'concrete', 'concrete');
  add(rect(HILL.x1, HILL.road[0], PARK, HILL.road[1]), [], 'asphalt', 'asphalt');
  add(rect(HILL.x1, HILL.road[1], PARK, PARK), [], 'grass', 'grass');
  // decorative paver bands around the plaza (visual only, flush)
  const band = (x0, z0, x1, z1) => {
    const g = flatPolygon(rect(x0, z0, x1, z1), [], 0.002);
    b.add(g, 'paver', null, { cast: false });
  };
  band(-41, -31, 41, -30.2);
  band(-41, 45.2, 41, 46);
  void band;
}

// ---------------- Plaza ----------------
function buildPlaza(b, out) {
  // --- 7 stair block with hubba + handrail ---
  const BX0 = -38, BX1 = -24, BZ0 = -6, BZ1 = 16, BH = 1.12;
  b.add(flatPolygon([[BX0, BZ0], [BX1, BZ0], [BX1, BZ1], [BX0, BZ1]], [], BH), 'concrete', 'concrete', { cast: false });
  blockWalls(b, BX0, BZ0, BX1, BZ1, BH, 'castConcrete', 'concrete', ['s']);
  // coping-like steel edge on drops + grind rails
  b.rail(V(BX1, BH, BZ0 + 0.05), V(BX1, BH, 2), 'concrete', 0.02);
  b.rail(V(BX1, BH, 9.7), V(BX1, BH, BZ1 - 0.05), 'concrete', 0.02);
  b.rail(V(BX0 + 0.05, BH, BZ1), V(BX1 - 0.05, BH, BZ1), 'concrete', 0.02);
  // stairs (travel up = -X)
  const stairX = BX1 + 6 * 0.32; // bottom edge
  const mS = matFromPosYaw(stairX, 0, 5.5, YAW_NX);
  P.stairs(b, mS, { n: 7, rise: 0.16, run: 0.32, width: 7, topDeck: 0.4 });
  // hubba on the north side of the stairs (local x=+3.8 -> world z=9.3)
  P.slopedLedge(b, mS, {
    top: [
      [-0.25, 0.485],
      [1.92, 1.57],
      [2.7, 1.57],
    ],
    width: 0.6,
    xc: 3.8,
    metal: true,
  });
  // handrail on the south side of the stairs (local x=-2.9 -> world z=2.6)
  {
    const x = -2.9;
    const yT = (u) => 1.0 + 0.5 * u;
    const r = 0.024;
    const pts = [V(x, yT(-0.55) - r, -0.55), V(x, yT(2.05) - r, 2.05), V(x, yT(2.05) - r, 2.6)];
    P.roundRail(b, mS, pts, {
      r,
      posts: [
        { x, z: -0.35, yTop: yT(-0.35) - r, yBase: 0 },
        { x, z: 0.8, yTop: yT(0.8) - r, yBase: 0.48 },
        { x, z: 2.45, yTop: yT(2.05) - r, yBase: 1.12 },
      ],
      mat: 'galvanized',
    });
  }
  // second, lower center rail on the stairs? (keep the set open) -> planter on top instead
  out.trees.push(P.planter(b, matFromPosYaw(-34.5, BH, 12.5, 0), { w: 3.2, d: 3.2, h: 0.5 }));
  P.bench(b, matFromPosYaw(-31, BH, -3.5, 0), { len: 2.4 });
  // access bank on the south face (travel +Z)
  {
    const bp = bankProfile(BH, 16, 3.0, 1.2);
    const z0 = BZ0 - bp.topZ;
    P.bank(b, matFromPosYaw((BX0 + BX1) / 2, 0, z0, YAW_PZ), { h: BH, angle: 16, rBot: 3.0, rTop: 1.2, deck: 0.4, width: BX1 - BX0, mat: 'smoothConcrete', deckMat: 'concrete' });
  }
  out.spots.push({ name: 'stairs', position: V(-33, BH, 5.5), yaw: YAW_PX });
  out.spots.push({ name: 'hubba', position: V(-34, BH, 8.65), yaw: YAW_PX });

  // --- ledges ---
  P.ledge(b, matFromPosYaw(-2, 0, 6, 0), { len: 7, h: 0.45, depth: 0.6, metal: true });
  P.ledge(b, matFromPosYaw(4, 0, -6, 0), { len: 8, h: 0.35, depth: 0.5, metal: false });
  P.ledge(b, matFromPosYaw(16, 0, 2, PI / 2), { len: 7, h: 0.55, depth: 0.7, metal: true });
  P.ledge(b, matFromPosYaw(-8, 0, 30, 0), { len: 6, h: 0.6, depth: 0.6, metal: true, capMat: 'paintBlack' });
  // long manual pad
  P.manualPad(b, matFromPosYaw(8, 0, 17, 0), { len: 9, w: 2.0, h: 0.2 });
  // flat bars
  P.flatBar(b, matFromPosYaw(2, 0, -18, 0), { len: 6, h: 0.35, square: false, mat: 'paintYellow' });
  P.flatBar(b, matFromPosYaw(14, 0, -21, 0), { len: 5, h: 0.3, square: true, mat: 'paintRed' });
  // gap with kicker over a planter (travel +X)
  P.kicker(b, matFromPosYaw(-14.5, 0, -18, YAW_PX), { h: 0.5, r: 2.2, width: 1.4, style: 'wood' });
  out.trees.push(P.planter(b, matFromPosYaw(-11.5, 0, -18, 0), { w: 2, d: 3, h: 0.6 }));
  // picnic table + benches
  P.picnicTable(b, matFromPosYaw(26, 0, -16, 0.15));
  P.bench(b, matFromPosYaw(22, 0, 9, PI / 2), { len: 2.4 });
  P.bench(b, matFromPosYaw(-14, 0, 39, 0), { len: 2.4 });
  P.bench(b, matFromPosYaw(4, 0, 38, 0), { len: 2.4 });
  P.bench(b, matFromPosYaw(36, 0, 14, PI / 2), { len: 2.4 });
  // planters with trees
  out.trees.push(P.planter(b, matFromPosYaw(-16, 0, 22, 0), { w: 3, d: 3, h: 0.55 }));
  out.trees.push(P.planter(b, matFromPosYaw(24, 0, -27, 0), { w: 3.4, d: 2.6, h: 0.5 }));
  out.trees.push(P.planter(b, matFromPosYaw(38, 0, -24, 0), { w: 3, d: 3, h: 0.5 }));
  out.trees.push(P.planter(b, matFromPosYaw(-2, 0, 44, 0), { w: 4, d: 2.4, h: 0.45 }));
  // curbs
  P.curb(b, matFromPosYaw(8, 0, -27.5, 0), { len: 8, mat: 'curbRed' });
  P.curb(b, matFromPosYaw(-22, 0, 36, 0), { len: 6, mat: 'curbYellow' });
  P.curb(b, matFromPosYaw(30, 0, 22, 0), { len: 7, mat: 'curbRed' });

  // --- euro gap (travel +X): bank up -> platform -> gap -> down bank ---
  {
    const zc = -3, W = 6, H = 0.7;
    const up = bankProfile(H, 20, 1.6, 0.25);
    const px0 = 22.5, px1 = 26;
    P.bank(b, matFromPosYaw(px0 - up.topZ, 0, zc, YAW_PX), { h: H, angle: 20, rBot: 1.6, rTop: 0.25, deck: 0.3, width: W });
    b.add(boxMM(px0, 0, zc - W / 2, px1, H, zc + W / 2), 'castConcrete', 'concrete', { worldUV: true });
    b.rail(V(px1, H, zc - W / 2 + 0.05), V(px1, H, zc + W / 2 - 0.05), 'concrete', 0.02);
    b.add(boxMM(px1 - 0.05, H - 0.004, zc - W / 2, px1 + 0.004, H + 0.003, zc + W / 2), 'steel', null);
    const dn = bankProfile(0.75, 24, 1.8, 0.25);
    const toe = 28 + dn.topZ + 0.5;
    P.bank(b, matFromPosYaw(toe, 0, zc, YAW_NX), { h: 0.75, angle: 24, rBot: 1.8, rTop: 0.25, deck: 0.5, width: W, lipRail: true });
    out.spots.push({ name: 'euro gap', position: V(10, 0, zc), yaw: YAW_PX });
  }

  // --- 3 stair with handrail (stairs face south, travel up = +Z) ---
  {
    const X0 = 24, X1 = 36, Z0 = 28, Z1 = 40, H = 0.48;
    b.add(flatPolygon(rect(X0, Z0, X1, Z1), [], H), 'concrete', 'concrete', { cast: false });
    blockWalls(b, X0, Z0, X1, Z1, H, 'castConcrete', 'concrete');
    b.rail(V(X0 + 0.05, H, Z0), V(26.9, H, Z0), 'concrete', 0.02);
    b.rail(V(33.1, H, Z0), V(X1 - 0.05, H, Z0), 'concrete', 0.02);
    b.rail(V(X1, H, Z0 + 0.05), V(X1, H, Z1 - 0.05), 'concrete', 0.02);
    const mS3 = matFromPosYaw(30, 0, Z0 - 2 * 0.32, YAW_PZ);
    P.stairs(b, mS3, { n: 3, rise: 0.16, run: 0.32, width: 6, topDeck: 0.3 });
    const yT = (u) => 1.0 + 0.5 * u;
    const r = 0.024;
    P.roundRail(b, mS3, [V(0, yT(-0.6) - r, -0.6), V(0, yT(0.75) - r, 0.75), V(0, yT(0.75) - r, 1.6)], {
      r,
      posts: [
        { x: 0, z: -0.4, yTop: yT(-0.4) - r, yBase: 0 },
        { x: 0, z: 0.5, yTop: yT(0.5) - r, yBase: 0.32 },
        { x: 0, z: 1.45, yTop: yT(0.75) - r, yBase: 0.48 },
      ],
      mat: 'paintBlack',
    });
    // west access bank (travel +X)
    const bp = bankProfile(H, 14, 2.0, 0.8);
    P.bank(b, matFromPosYaw(X0 - bp.topZ, 0, (Z0 + Z1) / 2, YAW_PX), { h: H, angle: 14, rBot: 2.0, rTop: 0.8, deck: 0.3, width: Z1 - Z0, deckMat: 'concrete' });
    P.ledge(b, matFromPosYaw(31, H, 37.5, 0), { len: 5, h: 0.4, depth: 0.55, metal: true });
    out.spots.push({ name: '3 stair', position: V(30, H, 37.5 - 2.5), yaw: YAW_NZ });
  }

  // --- bank to ledge (travel -X) ---
  {
    const H = 1.0, zc = 28, W = 8;
    const bp = bankProfile(H, 25, 1.8, 0.3);
    const toe = -29.5;
    P.bank(b, matFromPosYaw(toe, 0, zc, YAW_NX), { h: H, angle: 25, rBot: 1.8, rTop: 0.3, deck: 2.2, width: W });
    const lipX = toe - bp.topZ;
    P.ledge(b, matFromPosYaw(lipX - 0.3, H, zc, PI / 2), { len: W, h: 0.32, depth: 0.42, metal: true });
  }
}

// ---------------- Transition zone ----------------
function buildTransitions(b, out) {
  // mini ramp (wood), centered (-22,-60), travel along X
  {
    const cx = -22, cz = -60, flat = 3.0, W = 7, h = 1.3, r = 2.2, deck = 2.5;
    const L = P.quarterPipe(b, matFromPosYaw(cx - flat / 2, 0, cz, YAW_NX), { h, r, deck, width: W, style: 'wood' });
    P.quarterPipe(b, matFromPosYaw(cx + flat / 2, 0, cz, YAW_PX), { h, r, deck, width: W, style: 'wood' });
    b.add(boxMM(cx - flat / 2, 0, cz - W / 2, cx + flat / 2, 0.003, cz + W / 2), 'skateliteFlat', null, { cast: false });
    for (const s of [-1, 1]) {
      const xb = cx + s * (flat / 2 + L.depth) - s * 0.08;
      deckRailing(b, xb, h, cz - W / 2, cz + W / 2);
    }
    out.spots.push({ name: 'mini ramp', position: V(cx - flat / 2 - L.lipZ - 0.9, h, cz), yaw: YAW_PX });
  }
  // vert ramp (wood), centered (24,-60)
  {
    const cx = 24, cz = -60, flat = 5.0, W = 12, h = 3.6, r = 3.15, vert = 0.45, deck = 2.5;
    const L = P.quarterPipe(b, matFromPosYaw(cx - flat / 2, 0, cz, YAW_NX), { h, r, vert, deck, width: W, style: 'wood' });
    P.quarterPipe(b, matFromPosYaw(cx + flat / 2, 0, cz, YAW_PX), { h, r, vert, deck, width: W, style: 'wood' });
    b.add(boxMM(cx - flat / 2, 0, cz - W / 2, cx + flat / 2, 0.003, cz + W / 2), 'skateliteFlat', null, { cast: false });
    for (const s of [-1, 1]) {
      const xb = cx + s * (flat / 2 + L.depth) - s * 0.08;
      deckRailing(b, xb, h, cz - W / 2, cz + W / 2);
      // ladder
      const lx = cx + s * (flat / 2 + L.depth) + s * 0.15;
      for (const dz of [-0.25, 0.25]) b.add(boxMM(lx - 0.03, 0, cz + 4 + dz - 0.03, lx + 0.03, h + 0.9, cz + 4 + dz + 0.03), 'galvanized', null);
      for (let y = 0.3; y < h; y += 0.3) b.add(cylinderBetween(V(lx, y, cz + 3.75), V(lx, y, cz + 4.25), 0.015, 6, false), 'galvanized', null);
    }
    out.spots.push({ name: 'vert', position: V(cx - flat / 2 - L.lipZ - 0.9, h, cz), yaw: YAW_PX });
    out.spots.push({ name: 'vert bottom', position: V(cx - 1.5, 0, cz + 2), yaw: YAW_PX });
  }
  // spine (wood), ridge along Z at x=50
  P.spine(b, matFromPosYaw(50, 0, -62, YAW_PX), { h: 1.5, r: 2.2, width: 8, style: 'wood' });

  // concrete quarter pipe lines along the fences
  const qpLine = (segments, axis) => {
    for (const s of segments) {
      const { a0, a1, h, r, vert = 0, deck = 1.8, kind = 'qp', angle = 30 } = s;
      const W = a1 - a0;
      const c = (a0 + a1) / 2;
      let depth;
      if (kind === 'qp') depth = qpProfile(h, r, vert).lipZ + deck;
      else depth = bankProfile(h, angle, 2.2, 0.35).topZ + deck;
      let m;
      if (axis === 'west') m = matFromPosYaw(-PARK + depth, 0, c, YAW_NX);
      else if (axis === 'east') m = matFromPosYaw(PARK - depth, 0, c, YAW_PX);
      else m = matFromPosYaw(c, 0, -PARK + depth, YAW_NZ);
      if (kind === 'qp') P.quarterPipe(b, m, { h, r, vert, deck, width: W, style: 'concrete' });
      else P.bank(b, m, { h, angle, rBot: 2.2, rTop: 0.35, deck, width: W, lipRail: true });
    }
  };
  qpLine(
    [
      { a0: -28, a1: -10, h: 1.5, r: 2.2 },
      { a0: -10, a1: 10, h: 2.2, r: 3.0 },
      { a0: 10, a1: 30, h: 1.2, r: 2.0 },
      { a0: 30, a1: 50, h: 1.8, r: 2.6 },
    ],
    'west'
  );
  qpLine(
    [
      { a0: -32, a1: -12, h: 1.8, r: 2.6 },
      { a0: -12, a1: 10, h: 1.3, r: 2.0 },
      { a0: 10, a1: 34, h: 2.4, r: 3.0, vert: 0.15 },
    ],
    'east'
  );
  qpLine(
    [
      { a0: -40, a1: -12, h: 1.4, r: 2.2 },
      { a0: -12, a1: 10, h: 1.6, kind: 'bank', angle: 30, deck: 1.5 },
      { a0: 10, a1: 38, h: 2.0, r: 2.8 },
      { a0: 38, a1: 62, h: 1.2, r: 1.8 },
      { a0: 62, a1: 84, h: 1.8, kind: 'bank', angle: 30, deck: 1.5 },
    ],
    'south'
  );
  out.spots.push({ name: 'quarter pipes', position: V(-70, 0, 0), yaw: YAW_NX });

  // big 30° bank at the end of the hill run-out (travel +X)
  {
    const H = 2.2;
    const bp = bankProfile(H, 30, 3.0, 0.5);
    const toe = 76;
    P.bank(b, matFromPosYaw(toe, 0, (HILL.parapet[0] + PARK) / 2, YAW_PX), {
      h: H,
      angle: 30,
      rBot: 3.0,
      rTop: 0.5,
      deck: PARK - toe - bp.topZ,
      width: PARK - HILL.parapet[0],
      lipRail: false,
    });
    out.bankNE = { toe, topZ: bp.topZ, H };
    out.spots.push({ name: 'big bank', position: V(52, 0, 69), yaw: YAW_PX });
  }

  // funbox / pyramid with hubba + rail (west zone)
  {
    const cx = -62, cz = 20, hx = 3.5, hz = 1.6, h = 1.0;
    const m = matFromPosYaw(cx, 0, cz, 0);
    const pr = P.pyramid(b, m, { hx, hz, rc: 0.4, h, angle: 24, rBot: 1.6, rTop: 0.35 });
    const prof = pr.prof; // [d, y], d outward from plateau edge
    // hubba down the +Z face at local x=+1.6
    const top = [[hz - 0.9, h + 0.4]];
    for (let i = 0; i < prof.length; i += 3) top.push([hz + prof[i][0], prof[i][1] + 0.4]);
    top.push([hz + prof[prof.length - 1][0], 0.4]);
    P.slopedLedge(b, m, { top: dedupe(top), width: 0.5, xc: 1.6, metal: true });
    // handrail down the -Z face at local x=-1.4 (kinked)
    const yAt = (d) => {
      for (let i = 0; i < prof.length - 1; i++) if (d >= prof[i][0] && d <= prof[i + 1][0]) {
        const t = (d - prof[i][0]) / (prof[i + 1][0] - prof[i][0] || 1);
        return prof[i][1] + (prof[i + 1][1] - prof[i][1]) * t;
      }
      return d < 0 ? h : 0;
    };
    const reach = prof[prof.length - 1][0];
    const ds = [-0.9, 0.15, reach - 1.0, reach + 0.4];
    const rr = 0.024;
    const hr = 0.62;
    const pts = ds.map((d) => V(-1.4, (d <= 0.15 ? h : d >= reach - 1.0 ? (d >= reach ? 0 : yAt(d)) : yAt(d)) + hr - rr, -(hz + d)));
    // straight middle segment between the two kink points
    pts[1].y = h + hr - rr;
    pts[2].y = yAt(reach - 1.0) + hr - rr;
    pts[3].y = pts[2].y;
    P.roundRail(b, m, pts, {
      r: rr,
      mat: 'paintRed',
      posts: [
        { x: -1.4, z: -(hz - 0.7), yTop: pts[0].y, yBase: h },
        { x: -1.4, z: -(hz + reach * 0.5), yTop: (pts[1].y + pts[2].y) / 2, yBase: yAt(reach * 0.5) },
        { x: -1.4, z: -(hz + reach + 0.25), yTop: pts[3].y, yBase: 0 },
      ],
    });
    out.spots.push({ name: 'funbox', position: V(cx + 1.6, 0, cz + 12), yaw: YAW_NZ });
  }
  // pyramid (east zone)
  {
    const m = matFromPosYaw(58, 0, 14, PI / 4);
    P.pyramid(b, m, { hx: 1.8, hz: 1.8, rc: 0.5, h: 1.25, angle: 30, rBot: 1.8, rTop: 0.35 });
    out.spots.push({ name: 'pyramid', position: V(46, 0, 2), yaw: Math.atan2(58 - 46, 14 - 2) });
  }
  // second funbox: wedge + flat top + ledge (east zone)
  {
    const m = matFromPosYaw(58, 0, -14, 0);
    P.pyramid(b, m, { hx: 3.0, hz: 1.4, rc: 0.3, h: 0.6, angle: 20, rBot: 1.2, rTop: 0.25 });
    P.ledge(b, matFromPosYaw(58, 0.6, -14, 0), { len: 4.5, h: 0.35, depth: 0.45, metal: true });
  }
  // jersey barriers + a down rail in the transition zone
  P.jerseyBarrier(b, matFromPosYaw(0, 0, -44, 0), { len: 4 });
  P.jerseyBarrier(b, matFromPosYaw(-40, 0, -40, 0.3), { len: 3 });
  P.flatBar(b, matFromPosYaw(38, 0, -40, 0.2), { len: 7, h: 0.4, square: false, mat: 'paintBlue' });

  // bowl
  const bowl = buildBowl(b);
  out.spots.push({ name: 'bowl', position: V(BOWL.cx - 4, -BOWL.depth, BOWL.cz), yaw: YAW_PX });
  return bowl;
}

function deckRailing(b, x, deckY, z0, z1) {
  const r = 0.025;
  const y1 = deckY + 1.0;
  b.add(cylinderBetween(V(x, y1, z0 + 0.1), V(x, y1, z1 - 0.1), r, 8, true), 'galvanized', null);
  b.add(cylinderBetween(V(x, deckY + 0.5, z0 + 0.1), V(x, deckY + 0.5, z1 - 0.1), r * 0.8, 8, true), 'galvanized', null);
  const n = Math.max(2, Math.round((z1 - z0) / 1.8));
  for (let i = 0; i <= n; i++) {
    const z = z0 + 0.1 + ((z1 - z0 - 0.2) * i) / n;
    b.add(cylinderBetween(V(x, deckY, z), V(x, y1, z), r, 8, false), 'galvanized', null);
  }
}

// height of the rideable top surface along the fence lines (used for fence & scenery placement)
export function edgeHeight(x, z) {
  if (z > HILL.parapet[0] && x < HILL.x1) return hillY(x) + 0.15;
  return 0;
}

export function buildPark(b) {
  const out = { spots: [], trees: [], props: [] };
  const bowl = buildTransitions(b, out);
  buildGround(b, bowl.hole);
  buildPlaza(b, out);
  buildHill(b);
  out.spots.unshift({ name: 'plaza', position: V(0, 0, -1), yaw: 0 });
  out.spots.push({ name: 'hill top', position: V(-81, hillY(-81), 69), yaw: YAW_PX });
  out.spawn = { position: V(0, 0, -1), yaw: 0 };
  // light poles around plaza + zones
  const poles = [
    [-42, -30, 0],
    [42, -30, PI],
    [-42, 46, 0],
    [42, 46, PI],
    [0, -32, PI / 2],
    [-60, -40, PI / 2],
    [60, -40, PI / 2],
    [-62, 44, 0],
    [64, 40, PI],
    [-20, 58.6, -PI / 2],
    [30, 58.6, -PI / 2],
  ];
  for (const [x, z, yaw] of poles) P.lightPole(b, matFromPosYaw(x, 0, z, yaw), { h: 8.5 });
  // props (knockable cones and trash cans)
  out.props = [
    ['cone', 6, -10], ['cone', 7.2, -10.4], ['cone', 8.4, -10], ['cone', -6, 14], ['cone', -18, -6.5],
    ['cone', 12, 26], ['cone', 13, 26.8], ['cone', 30, -8], ['cone', -4, -24], ['cone', 20, 30],
    ['cone', -26, 40], ['cone', 40, 52], ['cone', -48, -46], ['cone', 20, -48],
    ['trash', -12.2, 39.8], ['trash', 6.5, 38.6], ['trash', 38, 10], ['trash', 28, -19], ['trash', -22.5, -12.5],
    ['trash', -40, 30], ['trash', 44, -30],
  ];
  return out;
}
