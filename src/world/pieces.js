// Reusable skatepark obstacles, built into a Builder with a transform matrix.
// Convention: local +Z is the direction a rider travels when riding INTO / UP the obstacle.
// Local origin is on the ground (y=0).
import * as THREE from 'three';
import { boxMM, boxC, cylinderBetween, extrudeProfile, qpProfile, bankProfile, kickerProfile, roundedRect, sweep, flatPolygon, filletPolyline, dedupe } from './shapes.js';
import { Geo } from './builder.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

const STYLES = {
  wood: { trans: 'skatelite', transSurf: 'wood', deck: 'plywood', deckSurf: 'wood', side: 'paintedWood', sideSurf: 'wood' },
  concrete: {
    trans: 'smoothConcrete',
    transSurf: 'smoothConcrete',
    deck: 'castConcrete',
    deckSurf: 'concrete',
    side: 'castConcrete',
    sideSurf: 'concrete',
  },
};

// Steel pipe coping + rail entry along the lip
export function coping(b, m, x0, x1, lipZ, h, r = 0.03, mat = 'coping') {
  const cy = h - r + 0.006;
  const cz = lipZ - 0.012;
  b.add(cylinderBetween(V(x0, cy, cz), V(x1, cy, cz), r, 12, true), mat, null, { matrix: m });
  b.rail(V(x0 + 0.03, h + 0.006, cz), V(x1 - 0.03, h + 0.006, cz), 'coping', r, m);
}

export function quarterPipe(b, m, { h, r, vert = 0, deck = 1.5, width = 4, style = 'wood', copingMat = 'coping', noCoping = false, x0 } = {}) {
  const S = STYLES[style];
  const qp = qpProfile(h, r, vert, 32);
  const lip = qp.lipZ;
  const xs = x0 ?? -width / 2;
  extrudeProfile(
    b,
    [
      { pts: qp.pts, mat: S.trans, surf: S.transSurf },
      { pts: [[lip, h], [lip + deck, h]], mat: S.deck, surf: S.deckSurf, smooth: false },
    ],
    width,
    m,
    { sideMat: S.side, sideSurf: S.sideSurf, x0: xs }
  );
  if (!noCoping) coping(b, m, xs, xs + width, lip, h, 0.03, copingMat);
  return { lipZ: lip, depth: lip + deck };
}

// Bank with smooth bottom/top fillets and a flat deck. Returns { topZ, depth }
export function bank(b, m, { h, angle = 30, rBot = 1.6, rTop = 0.4, deck = 1.0, width = 4, mat = 'smoothConcrete', surf = 'smoothConcrete', deckMat = 'castConcrete', deckSurf = 'concrete', sideMat = 'castConcrete', lipRail = false, x0 } = {}) {
  const bp = bankProfile(h, angle, rBot, rTop, 32);
  const xs = x0 ?? -width / 2;
  const segs = [{ pts: bp.pts, mat, surf }];
  if (deck > 0) segs.push({ pts: [[bp.topZ, h], [bp.topZ + deck, h]], mat: deckMat, surf: deckSurf, smooth: false });
  extrudeProfile(b, segs, width, m, { sideMat, sideSurf: 'concrete', x0: xs });
  if (lipRail && deck > 0) b.rail(V(xs + 0.05, h, bp.topZ + deck), V(xs + width - 0.05, h, bp.topZ + deck), 'concrete', 0.02, m);
  return { topZ: bp.topZ, depth: bp.topZ + deck, pts: bp.pts };
}

export function kicker(b, m, { h = 0.45, r = 2.0, width = 1.2, deck = 0.25, style = 'wood' } = {}) {
  const kp = kickerProfile(h, r);
  const z0 = -(kp.topZ + deck) / 2;
  const pts = kp.pts.map(([z, y]) => [z + z0, y]);
  const top = pts[pts.length - 1];
  const S = STYLES[style];
  extrudeProfile(
    b,
    [
      { pts, mat: S.trans, surf: S.transSurf },
      { pts: [[top[0], h], [top[0] + deck, h]], mat: S.deck, surf: S.deckSurf, smooth: false },
    ],
    width,
    m,
    { sideMat: S.side, sideSurf: S.sideSurf }
  );
  // steel lip plate at the bottom (visual)
  b.add(boxMM(-width / 2, 0, z0 - 0.06, width / 2, 0.006, z0 + 0.02), 'steel', null, { matrix: m, cast: false });
  return { length: kp.topZ + deck };
}

// Ledge / box. Centered at origin, long axis along X.
export function ledge(b, m, { len = 4, h = 0.45, depth = 0.6, metal = true, mat = 'castConcrete', surf = 'concrete', railKind, capMat = 'steel', bothSides = true } = {}) {
  b.add(boxMM(-len / 2, 0, -depth / 2, len / 2, h, depth / 2), mat, surf, { matrix: m, worldUV: !!m && mat !== 'benchWood' });
  const kind = railKind || (metal ? 'metal' : 'concrete');
  const sides = bothSides ? [-1, 1] : [-1];
  for (const s of sides) {
    const z = (s * depth) / 2;
    if (metal) {
      // angle iron: top flange (on the deck) + face flange (on the side)
      const zi = z - s * 0.05; // inner edge of top flange
      b.add(boxMM(-len / 2, h - 0.004, Math.min(z, zi), len / 2, h + 0.003, Math.max(z, zi)), capMat, null, { matrix: m });
      const zo = z + s * 0.004;
      b.add(boxMM(-len / 2, h - 0.05, Math.min(z, zo), len / 2, h + 0.003, Math.max(z, zo)), capMat, null, { matrix: m });
    }
    b.rail(V(-len / 2 + 0.02, h, z), V(len / 2 - 0.02, h, z), kind, 0.02, m);
  }
}

// Sloped ledge (hubba): profile pts [[z, y]] = top line, width along X centered at xc
export function slopedLedge(b, m, { top, width = 0.6, xc = 0, metal = true, mat = 'castConcrete' } = {}) {
  extrudeProfile(b, [{ pts: top, mat, surf: 'concrete', smooth: false }], width, m, { sideMat: mat, sideSurf: 'concrete', x0: xc - width / 2 });
  for (const s of [-1, 1]) {
    const x = xc + (s * width) / 2;
    for (let i = 0; i < top.length - 1; i++) {
      const A = V(x, top[i][1], top[i][0]);
      const B = V(x, top[i + 1][1], top[i + 1][0]);
      b.rail(A, B, metal ? 'metal' : 'concrete', 0.02, m);
      if (metal) {
        const dir = B.clone().sub(A);
        const a2 = A.clone().add(V(-s * 0.025, -0.002, 0));
        const b2 = a2.clone().add(dir);
        b.add(cylinderBetween(a2, b2, 0.008, 4, false), 'steel', null, { matrix: m, cast: false });
      }
    }
  }
}

// Stairs: n risers, going up toward +Z, starting at z=0, width along X. Top lands at z=(n-1)*run.
export function stairs(b, m, { n = 7, rise = 0.16, run = 0.32, width = 6, mat = 'castConcrete', topDeck = 0.3, x0 } = {}) {
  const pts = [[0, 0]];
  for (let i = 0; i < n; i++) {
    pts.push([i * run, (i + 1) * rise]);
    if (i < n - 1) pts.push([(i + 1) * run, (i + 1) * rise]);
  }
  pts.push([(n - 1) * run + topDeck, n * rise]);
  extrudeProfile(b, [{ pts: dedupe(pts), mat, surf: 'concrete', smooth: false }], width, m, { sideMat: mat, sideSurf: 'concrete', x0: x0 ?? -width / 2 });
  // steel nosings (visual)
  const xs = x0 ?? -width / 2;
  for (let i = 0; i < n; i++) {
    const z = i * run;
    const y = (i + 1) * rise;
    b.add(boxMM(xs + 0.02, y - 0.03, z - 0.004, xs + width - 0.02, y + 0.002, z + 0.03), 'darkSteel', null, { matrix: m, cast: false });
  }
  return { length: (n - 1) * run, height: n * rise };
}

// Round rail following centerline points (Vector3s); posts at given indices/positions (array of {x,z, yTop, yBase}).
export function roundRail(b, m, pts, { r = 0.024, posts = [], kind = 'metal', mat = 'galvanized', postMat } = {}) {
  for (let i = 0; i < pts.length - 1; i++) {
    b.add(cylinderBetween(pts[i], pts[i + 1], r, 10, false), mat, null, { matrix: m });
    b.rail(pts[i].clone().add(V(0, r, 0)), pts[i + 1].clone().add(V(0, r, 0)), kind, r, m);
  }
  for (const p of [pts[0], pts[pts.length - 1]]) {
    const s = new THREE.SphereGeometry(r, 10, 6);
    s.translate(p.x, p.y, p.z);
    b.add(s, mat, null, { matrix: m });
  }
  for (let i = 1; i < pts.length - 1; i++) {
    const s = new THREE.SphereGeometry(r * 1.01, 10, 6);
    s.translate(pts[i].x, pts[i].y, pts[i].z);
    b.add(s, mat, null, { matrix: m });
  }
  for (const p of posts) {
    const top = V(p.x, p.yTop, p.z);
    const base = V(p.x, p.yBase ?? 0, p.z);
    b.add(cylinderBetween(base, top, r * 0.95, 8, false), postMat || mat, null, { matrix: m });
    // base plate
    b.add(boxMM(p.x - 0.07, base.y, p.z - 0.07, p.x + 0.07, base.y + 0.01, p.z + 0.07), 'darkSteel', null, { matrix: m, cast: false });
  }
}

// Flat bar (round or square), long axis along X.
export function flatBar(b, m, { len = 5, h = 0.35, square = false, mat = 'paintYellow' } = {}) {
  const s = 0.025;
  if (square) {
    b.add(boxMM(-len / 2, h - 2 * s, -s, len / 2, h, s), mat, null, { matrix: m });
    b.rail(V(-len / 2 + 0.02, h, 0), V(len / 2 - 0.02, h, 0), 'metal', s, m);
  } else {
    b.add(cylinderBetween(V(-len / 2, h - s, 0), V(len / 2, h - s, 0), s, 12, true), mat, null, { matrix: m });
    b.rail(V(-len / 2 + 0.02, h, 0), V(len / 2 - 0.02, h, 0), 'metal', s, m);
  }
  const nLegs = Math.max(2, Math.round(len / 2.2) + 1);
  for (let i = 0; i < nLegs; i++) {
    const x = -len / 2 + 0.25 + ((len - 0.5) * i) / (nLegs - 1);
    b.add(boxMM(x - 0.02, 0, -0.02, x + 0.02, h - 0.04, 0.02), mat, null, { matrix: m });
    b.add(boxMM(x - 0.15, 0, -0.12, x + 0.15, 0.008, 0.12), 'darkSteel', null, { matrix: m, cast: false });
  }
}

export function bench(b, m, { len = 2.2, h = 0.46, depth = 0.5, legMat = 'castConcrete' } = {}) {
  // concrete pedestals + wooden slats + steel edge
  for (const x of [-len / 2 + 0.35, len / 2 - 0.35]) {
    b.add(boxMM(x - 0.12, 0, -depth / 2 + 0.05, x + 0.12, h - 0.06, depth / 2 - 0.05), legMat, null, { matrix: m });
  }
  const ns = 5;
  const gap = 0.012;
  const sw = (depth - gap * (ns - 1)) / ns;
  for (let i = 0; i < ns; i++) {
    const z = -depth / 2 + i * (sw + gap);
    b.add(boxMM(-len / 2, h - 0.06, z, len / 2, h, z + sw), 'benchWood', null, { matrix: m });
  }
  for (const s of [-1, 1]) {
    b.add(boxMM(-len / 2, h - 0.06, s > 0 ? depth / 2 - 0.004 : -depth / 2, len / 2, h + 0.002, s > 0 ? depth / 2 + 0.002 : -depth / 2 + 0.004), 'steel', null, { matrix: m });
    b.rail(V(-len / 2 + 0.02, h, (s * depth) / 2), V(len / 2 - 0.02, h, (s * depth) / 2), 'wood', 0.02, m);
  }
  b.collider(boxMM(-len / 2, 0, -depth / 2, len / 2, h, depth / 2), 'wood', m);
}

export function picnicTable(b, m) {
  const L = 2.0;
  const topH = 0.76;
  const seatH = 0.45;
  // table top planks along X
  for (let i = 0; i < 5; i++) {
    const z = -0.4 + i * 0.162;
    b.add(boxMM(-L / 2, topH - 0.045, z, L / 2, topH, z + 0.15), 'benchWood', null, { matrix: m });
  }
  for (const s of [-1, 1]) {
    for (let i = 0; i < 2; i++) {
      const z = s * (0.62 + i * 0.13) - 0.06;
      b.add(boxMM(-L / 2, seatH - 0.045, z, L / 2, seatH, z + 0.12), 'benchWood', null, { matrix: m });
    }
    b.rail(V(-L / 2 + 0.02, seatH, s > 0 ? 0.87 : -0.87), V(L / 2 - 0.02, seatH, s > 0 ? 0.87 : -0.87), 'wood', 0.02, m);
    b.rail(V(-L / 2 + 0.02, topH, s * 0.405), V(L / 2 - 0.02, topH, s * 0.405), 'wood', 0.02, m);
  }
  // A-frame legs (steel)
  for (const x of [-L / 2 + 0.25, L / 2 - 0.25]) {
    for (const s of [-1, 1]) {
      b.add(cylinderBetween(V(x, 0, s * 0.75), V(x, topH - 0.05, s * 0.1), 0.03, 8, false), 'paintGreen', null, { matrix: m });
    }
    b.add(cylinderBetween(V(x, seatH - 0.07, -0.95), V(x, seatH - 0.07, 0.95), 0.025, 8, true), 'paintGreen', null, { matrix: m });
  }
  b.collider(boxMM(-L / 2, topH - 0.05, -0.41, L / 2, topH, 0.41), 'wood', m);
  b.collider(boxMM(-L / 2, 0, 0.56, L / 2, seatH, 0.88), 'wood', m);
  b.collider(boxMM(-L / 2, 0, -0.88, L / 2, seatH, -0.56), 'wood', m);
}

// Raised planter (rim concrete, soil fill). Returns center for a tree.
export function planter(b, m, { w = 3, d = 3, h = 0.55, rim = 0.22, mat = 'castConcrete' } = {}) {
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2;
  b.add(boxMM(x0, 0, z0, x1, h, z0 + rim), mat, 'concrete', { matrix: m, worldUV: true });
  b.add(boxMM(x0, 0, z1 - rim, x1, h, z1), mat, 'concrete', { matrix: m, worldUV: true });
  b.add(boxMM(x0, 0, z0 + rim, x0 + rim, h, z1 - rim), mat, 'concrete', { matrix: m, worldUV: true });
  b.add(boxMM(x1 - rim, 0, z0 + rim, x1, h, z1 - rim), mat, 'concrete', { matrix: m, worldUV: true });
  b.add(boxMM(x0 + rim, 0, z0 + rim, x1 - rim, h - 0.07, z1 - rim), 'dirt', 'dirt', { matrix: m, worldUV: true, cast: false });
  // outer top edges grindable
  b.rail(V(x0 + 0.03, h, z0), V(x1 - 0.03, h, z0), 'concrete', 0.02, m);
  b.rail(V(x0 + 0.03, h, z1), V(x1 - 0.03, h, z1), 'concrete', 0.02, m);
  b.rail(V(x0, h, z0 + 0.03), V(x0, h, z1 - 0.03), 'concrete', 0.02, m);
  b.rail(V(x1, h, z0 + 0.03), V(x1, h, z1 - 0.03), 'concrete', 0.02, m);
  return new THREE.Vector3(0, h - 0.07, 0).applyMatrix4(m || new THREE.Matrix4());
}

// Pyramid / funbox from a swept rounded rectangle plateau.
export function pyramid(b, m, { hx = 1.5, hz = 1.5, rc = 0.3, h = 1.0, angle = 28, rBot = 1.4, rTop = 0.35, mat = 'smoothConcrete', topMat = 'castConcrete' } = {}) {
  const curve = roundedRect(hx, hz, rc, 16, 2);
  const bp = bankProfile(h, angle, rBot, rTop, 28);
  const prof = bp.pts.slice().reverse().map(([z, y]) => [bp.topZ - z, y]);
  sweep(b, curve, prof, { mat, surf: 'smoothConcrete', matrix: m });
  b.add(
    flatPolygon(
      curve.map((c) => [c.x, c.z]),
      [],
      h
    ),
    topMat,
    'concrete',
    { matrix: m, worldUV: true }
  );
  return { reach: bp.topZ, prof, curve };
}

// Hubba that follows a bank slope (profile pts of the bank, raised by `lift`)
export function bankHubba(b, m, { bankPts, lift = 0.4, width = 0.5, xc = 0, extraTop = 0.6, metal = true }) {
  // simplified line: sample every few points
  const pts = [];
  for (let i = 0; i < bankPts.length; i += 4) pts.push([bankPts[i][0], bankPts[i][1] + lift]);
  const last = bankPts[bankPts.length - 1];
  pts.push([last[0], last[1] + lift]);
  pts.push([last[0] + extraTop, last[1] + lift]);
  // start: drop to a short vertical face near the toe
  slopedLedge(b, m, { top: dedupe(pts), width, xc, metal });
}

export function manualPad(b, m, { len = 6, w = 1.8, h = 0.2, mat = 'castConcrete' } = {}) {
  b.add(boxMM(-len / 2, 0, -w / 2, len / 2, h, w / 2), mat, 'concrete', { matrix: m, worldUV: !!m });
  for (const s of [-1, 1]) {
    b.add(boxMM(-len / 2, h - 0.004, s > 0 ? w / 2 - 0.04 : -w / 2 - 0.004, len / 2, h + 0.002, s > 0 ? w / 2 + 0.004 : -w / 2 + 0.04), 'steel', null, { matrix: m });
    b.rail(V(-len / 2 + 0.02, h, (s * w) / 2), V(len / 2 - 0.02, h, (s * w) / 2), 'metal', 0.02, m);
    b.add(boxMM(s > 0 ? len / 2 - 0.04 : -len / 2 - 0.004, h - 0.004, -w / 2, s > 0 ? len / 2 + 0.004 : -len / 2 + 0.04, h + 0.002, w / 2), 'steel', null, { matrix: m });
    b.rail(V((s * len) / 2, h, -w / 2 + 0.02), V((s * len) / 2, h, w / 2 - 0.02), 'metal', 0.02, m);
  }
}

export function curb(b, m, { len = 6, h = 0.18, w = 0.35, mat = 'curbRed' } = {}) {
  // slightly chamfered painted curb
  const pts = [
    [-w / 2, 0],
    [-w / 2, h - 0.02],
    [-w / 2 + 0.02, h],
    [w / 2 - 0.02, h],
    [w / 2, h - 0.02],
    [w / 2, 0],
  ];
  const mm = new THREE.Matrix4().makeRotationY(Math.PI / 2);
  const M = m ? m.clone().multiply(mm) : mm;
  extrudeProfile(b, [{ pts, mat, surf: 'concrete', smooth: false }], len, M, { sideMat: mat, sideSurf: 'concrete' });
  for (const s of [-1, 1]) b.rail(V(-len / 2 + 0.02, h, (s * w) / 2), V(len / 2 - 0.02, h, (s * w) / 2), 'concrete', 0.02, m);
}

export function jerseyBarrier(b, m, { len = 3.0, mat = 'darkConcrete' } = {}) {
  const pts = [
    [-0.3, 0],
    [-0.3, 0.075],
    [-0.175, 0.33],
    [-0.08, 0.81],
    [0.08, 0.81],
    [0.175, 0.33],
    [0.3, 0.075],
    [0.3, 0],
  ];
  const mm = new THREE.Matrix4().makeRotationY(Math.PI / 2);
  const M = m ? m.clone().multiply(mm) : mm;
  extrudeProfile(b, [{ pts, mat, surf: 'concrete', smooth: false }], len, M, { sideMat: mat, sideSurf: 'concrete' });
  b.rail(V(-len / 2 + 0.03, 0.81, 0), V(len / 2 - 0.03, 0.81, 0), 'concrete', 0.08, m);
}

export function spine(b, m, { h = 1.4, r = 2.0, width = 6, style = 'wood' } = {}) {
  const S = STYLES[style];
  const qp = qpProfile(h, r, 0, 32);
  const lip = qp.lipZ;
  const back = qp.pts
    .slice()
    .reverse()
    .map(([z, y]) => [2 * lip - z, y]);
  // shift so peak at z=0
  const front = qp.pts.map(([z, y]) => [z - lip, y]);
  const rear = back.map(([z, y]) => [z - lip, y]);
  extrudeProfile(
    b,
    [
      { pts: front, mat: S.trans, surf: S.transSurf },
      { pts: rear, mat: S.trans, surf: S.transSurf },
    ],
    width,
    m,
    { sideMat: S.side, sideSurf: S.sideSurf }
  );
  b.add(cylinderBetween(V(-width / 2, h - 0.01, 0), V(width / 2, h - 0.01, 0), 0.033, 12, true), 'coping', null, { matrix: m });
  b.rail(V(-width / 2 + 0.03, h + 0.023, 0), V(width / 2 - 0.03, h + 0.023, 0), 'coping', 0.033, m);
  return { half: lip };
}

export function lightPole(b, m, { h = 8, arm = 1.4 } = {}) {
  b.add(cylinderBetween(V(0, 0, 0), V(0, h, 0), 0.11, 10, false, 0.07), 'galvanized', null, { matrix: m });
  b.add(boxMM(-0.22, 0, -0.22, 0.22, 0.35, 0.22), 'castConcrete', null, { matrix: m });
  b.add(cylinderBetween(V(0, h - 0.1, 0), V(arm, h + 0.15, 0), 0.05, 8, false), 'galvanized', null, { matrix: m });
  b.add(boxMM(arm - 0.35, h + 0.02, -0.18, arm + 0.35, h + 0.2, 0.18), 'darkSteel', null, { matrix: m });
  b.add(boxMM(arm - 0.3, h, -0.14, arm + 0.3, h + 0.022, 0.14), 'lampGlow', null, { matrix: m, cast: false });
}

export function trafficConeGeometry() {
  const G = [];
  const base = new THREE.BoxGeometry(0.38, 0.03, 0.38);
  base.translate(0, 0.015, 0);
  const cone = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.0, 0.7),
      new THREE.Vector2(0.03, 0.7),
      new THREE.Vector2(0.045, 0.66),
      new THREE.Vector2(0.135, 0.03),
      new THREE.Vector2(0.15, 0.03),
    ],
    18
  );
  const colorize = (g, fn) => {
    const p = g.attributes.position;
    const c = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const [r, gg, bb] = fn(p.getY(i));
      c[i * 3] = r;
      c[i * 3 + 1] = gg;
      c[i * 3 + 2] = bb;
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return g;
  };
  colorize(base, () => [0.03, 0.03, 0.03]);
  // reflective white bands between y 0.38-0.48 and 0.22-0.28 (split by vertices: add rings)
  const cone2 = new THREE.LatheGeometry(
    [0.7, 0.66, 0.5, 0.49, 0.4, 0.39, 0.3, 0.29, 0.03].map((y, i) =>
      i === 0 ? new THREE.Vector2(0.03, 0.7) : new THREE.Vector2(0.045 + ((0.66 - y) / 0.63) * 0.09, y)
    ),
    18
  );
  void cone;
  colorize(cone2, (y) => (y > 0.395 && y < 0.495 ? [0.92, 0.92, 0.9] : y > 0.295 && y < 0.395 ? [0.92, 0.92, 0.9] : [0.95, 0.28, 0.03]));
  G.push(base.toNonIndexed(), cone2.toNonIndexed());
  return G;
}

export function trashCanGeometry() {
  const body = new THREE.LatheGeometry(
    [
      [0.0, 0.0],
      [0.25, 0.0],
      [0.27, 0.05],
      [0.27, 0.86],
      [0.29, 0.88],
      [0.29, 0.92],
      [0.22, 0.95],
      [0.0, 0.96],
    ].map(([r, y]) => new THREE.Vector2(r, y)),
    20
  );
  const p = body.attributes.position;
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const band = (y > 0.15 && y < 0.2) || (y > 0.7 && y < 0.75);
    const col = y > 0.86 ? [0.08, 0.09, 0.1] : band ? [0.1, 0.1, 0.1] : [0.12, 0.33, 0.22];
    c.set(col, i * 3);
  }
  body.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return [body.toNonIndexed()];
}

export { boxMM, boxC, filletPolyline };
export const _geo = Geo;
