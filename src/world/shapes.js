// Parametric shape primitives: profiles, extrusions, sweeps, tubes, polygons.
import * as THREE from 'three';
import { Geo, planarUV } from './builder.js';

const EPS = 1e-6;

// ---------------- primitives ----------------
export function boxMM(x0, y0, z0, x1, y1, z1) {
  const g = new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0));
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return planarUV(g);
}

// box centered on x/z, from y0 to y1
export function boxC(cx, cz, w, d, y0, y1) {
  return boxMM(cx - w / 2, y0, cz - d / 2, cx + w / 2, y1, cz + d / 2);
}

export function cylinderBetween(a, b, r, segs = 10, capped = true, r2 = r) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r2, r, len, segs, 1, !capped);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.PI * 2 * r, uv.getY(i) * len);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  return g;
}

// Tube following a polyline (orientation frame from world up). closed: loop.
export function tubeAlong(points, r, segs = 8, closed = false) {
  const G = new Geo();
  const n = points.length;
  const up = new THREE.Vector3(0, 1, 0);
  const t = new THREE.Vector3();
  const s = new THREE.Vector3();
  const u = new THREE.Vector3();
  let along = 0;
  const cols = closed ? n + 1 : n;
  for (let i = 0; i < cols; i++) {
    const P = points[i % n];
    const prev = points[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
    const next = points[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    t.subVectors(next, prev).normalize();
    s.crossVectors(t, up);
    if (s.lengthSq() < 1e-8) s.set(1, 0, 0);
    s.normalize();
    u.crossVectors(s, t).normalize();
    if (i > 0) along += P.distanceTo(points[(i - 1) % n]);
    for (let k = 0; k <= segs; k++) {
      const a = (k / segs) * Math.PI * 2;
      const nx = s.x * Math.cos(a) + u.x * Math.sin(a);
      const ny = s.y * Math.cos(a) + u.y * Math.sin(a);
      const nz = s.z * Math.cos(a) + u.z * Math.sin(a);
      G.vert(P.x + nx * r, P.y + ny * r, P.z + nz * r, nx, ny, nz, (k / segs) * Math.PI * 2 * r, along);
    }
  }
  const row = segs + 1;
  for (let i = 0; i < cols - 1; i++) {
    for (let k = 0; k < segs; k++) {
      const a = i * row + k;
      const b = (i + 1) * row + k;
      const p = G.p;
      const nx = G.n[a * 3], ny = G.n[a * 3 + 1], nz = G.n[a * 3 + 2];
      G.quadO(a, b, b + 1, a + 1, nx, ny, nz);
      void p;
    }
  }
  return G.toGeometry();
}

// Flat horizontal polygon at height y (contour/holes: arrays of [x,z]).
export function flatPolygon(contour, holes = [], y = 0, up = true) {
  const c2 = contour.map(([x, z]) => new THREE.Vector2(x, z));
  const h2 = holes.map((h) => h.map(([x, z]) => new THREE.Vector2(x, z)));
  const tris = THREE.ShapeUtils.triangulateShape(c2, h2);
  const all = [...c2, ...h2.flat()];
  const G = new Geo();
  const ny = up ? 1 : -1;
  for (const v of all) G.vert(v.x, y, v.y, 0, ny, 0, v.x, v.y);
  for (const [a, b, c] of tris) G.triO(a, b, c, 0, ny, 0);
  return G.toGeometry();
}

// ---------------- 2D profiles ([z, y] pairs) ----------------
export function arcPoints(cx, cy, r, a0, a1, segsPer90 = 32) {
  const n = Math.max(2, Math.ceil((Math.abs(a1 - a0) / (Math.PI / 2)) * segsPer90));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

// Round interior corners of a polyline with given radii (radii[i] for vertex i; ends ignored).
export function filletPolyline(pts, radii, segsPer90 = 32) {
  const out = [pts[0].slice()];
  for (let i = 1; i < pts.length - 1; i++) {
    const r = radii[i] || 0;
    const P = pts[i];
    if (r <= 0) {
      out.push(P.slice());
      continue;
    }
    const A = pts[i - 1];
    const B = pts[i + 1];
    let d1x = P[0] - A[0], d1y = P[1] - A[1];
    let l = Math.hypot(d1x, d1y);
    d1x /= l;
    d1y /= l;
    let d2x = B[0] - P[0], d2y = B[1] - P[1];
    l = Math.hypot(d2x, d2y);
    d2x /= l;
    d2y /= l;
    const cross = d1x * d2y - d1y * d2x;
    const dot = Math.max(-1, Math.min(1, d1x * d2x + d1y * d2y));
    const phi = Math.acos(dot);
    if (phi < 1e-4) {
      out.push(P.slice());
      continue;
    }
    const t = r * Math.tan(phi / 2);
    const S = [P[0] - d1x * t, P[1] - d1y * t];
    const sgn = cross > 0 ? 1 : -1;
    // center: left normal of d1 for left turns
    const nx = -d1y * sgn;
    const ny = d1x * sgn;
    const C = [S[0] + nx * r, S[1] + ny * r];
    const a0 = Math.atan2(S[1] - C[1], S[0] - C[0]);
    const a1 = a0 + sgn * phi;
    const arc = arcPoints(C[0], C[1], r, a0, a1, segsPer90);
    for (const q of arc) out.push(q);
  }
  out.push(pts[pts.length - 1].slice());
  return dedupe(out);
}

export function dedupe(pts, eps = 1e-5) {
  const o = [];
  for (const p of pts) {
    const q = o[o.length - 1];
    if (!q || Math.abs(q[0] - p[0]) > eps || Math.abs(q[1] - p[1]) > eps) o.push(p);
  }
  return o;
}

// Quarter pipe transition: tangent at (0,0), radius r, up to height h (incl. `vert` straight wall).
// Returns { pts, lipZ, h }
export function qpProfile(h, r, vert = 0, segsPer90 = 32) {
  const ha = Math.min(r, h - vert);
  const thMax = Math.acos(Math.max(-1, Math.min(1, (r - ha) / r)));
  const n = Math.max(8, Math.ceil((thMax / (Math.PI / 2)) * segsPer90));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const th = (thMax * i) / n;
    pts.push([r * Math.sin(th), r * (1 - Math.cos(th))]);
  }
  const lipZ = r * Math.sin(thMax);
  if (h - ha > 1e-4) {
    // straight extension (vertical if thMax=90deg, else along tangent)
    const ext = h - ha;
    const tz = Math.cos(thMax);
    const ty = Math.sin(thMax);
    const k = ext / ty;
    pts.push([lipZ + tz * k, ha + ext]);
  }
  return { pts, lipZ: pts[pts.length - 1][0], h, angle: thMax };
}

// Bank: smooth bottom fillet (tangent to ground) -> straight slope -> top fillet -> flat.
// returns { pts (start at [0,0]), topZ: z where flat top begins }
export function bankProfile(h, angleDeg, rBot = 1.5, rTop = 0.4, segsPer90 = 32) {
  const a = (angleDeg * Math.PI) / 180;
  const L = h / Math.tan(a);
  const raw = filletPolyline(
    [
      [-20, 0],
      [0, 0],
      [L, h],
      [L + 20, h],
    ],
    [0, rBot, rTop, 0],
    segsPer90
  );
  // trim straight lead-in/out
  raw.shift();
  raw.pop();
  const z0 = raw[0][0];
  const pts = raw.map(([z, y]) => [z - z0, Math.abs(y) < 1e-9 ? 0 : y]);
  pts[0][1] = 0;
  const top = pts[pts.length - 1];
  top[1] = h;
  return { pts, topZ: top[0] };
}

// Kicker: circular arc from flat up to height h with radius r.
export function kickerProfile(h, r, segsPer90 = 40) {
  const th = Math.acos(1 - h / r);
  return { pts: arcPoints(0, r, r, -Math.PI / 2, -Math.PI / 2 + th, segsPer90), topZ: r * Math.sin(th), angle: th };
}

// ---------------- extrusion along X ----------------
// segs: [{ pts:[[z,y]...], mat, surf, smooth=true }] contiguous profile ("travel order": solid lies to the right/below).
// Surface spans x in [-width/2, width/2]. Side walls + end caps generated with sideMat/sideSurf.
export function extrudeProfile(b, segs, width, matrix, opts = {}) {
  const { sideMat = segs[0].mat, sideSurf = segs[0].surf, sides = true, caps = true, x0 = -width / 2, capMat = sideMat, capSurf = sideSurf, sideCast = true } = opts;
  const x1 = x0 + width;
  let vAcc = 0;
  const all = [];
  for (const s of segs) {
    const pts = s.pts;
    const G = new Geo();
    const smooth = s.smooth !== false;
    const nseg = pts.length - 1;
    const segN = [];
    for (let i = 0; i < nseg; i++) {
      const dz = pts[i + 1][0] - pts[i][0];
      const dy = pts[i + 1][1] - pts[i][1];
      const l = Math.hypot(dz, dy) || 1;
      segN.push([-dy / l, dz / l, l]); // [nz, ny, len]
    }
    if (smooth) {
      const vn = [];
      for (let i = 0; i <= nseg; i++) {
        const A = segN[Math.max(0, i - 1)];
        const B = segN[Math.min(nseg - 1, i)];
        let nz = A[0] + B[0];
        let ny = A[1] + B[1];
        const l = Math.hypot(nz, ny) || 1;
        vn.push([nz / l, ny / l]);
      }
      let v = vAcc;
      for (let i = 0; i <= nseg; i++) {
        if (i > 0) v += segN[i - 1][2];
        const [z, y] = pts[i];
        G.vert(x0, y, z, 0, vn[i][1], vn[i][0], x0, v);
        G.vert(x1, y, z, 0, vn[i][1], vn[i][0], x1, v);
      }
      for (let i = 0; i < nseg; i++) {
        const a = i * 2;
        G.quadO(a, a + 1, a + 3, a + 2, 0, segN[i][1], segN[i][0]);
      }
      vAcc = v;
    } else {
      let v = vAcc;
      for (let i = 0; i < nseg; i++) {
        const [nz, ny, l] = segN[i];
        const [za, ya] = pts[i];
        const [zb, yb] = pts[i + 1];
        const a = G.vert(x0, ya, za, 0, ny, nz, x0, v);
        G.vert(x1, ya, za, 0, ny, nz, x1, v);
        G.vert(x1, yb, zb, 0, ny, nz, x1, v + l);
        G.vert(x0, yb, zb, 0, ny, nz, x0, v + l);
        G.quadO(a, a + 1, a + 2, a + 3, 0, ny, nz);
        v += l;
      }
      vAcc = v;
    }
    b.add(G.toGeometry(), s.mat, s.surf, { matrix, cast: s.cast !== false });
    for (const p of pts) all.push(p);
  }
  const prof = dedupe(all);
  const first = prof[0];
  const last = prof[prof.length - 1];
  // side walls
  if (sides) {
    const poly = prof.map((p) => p.slice());
    if (last[1] > EPS) poly.push([last[0], 0]);
    if (first[1] > EPS) poly.push([first[0], 0]);
    const c2 = dedupe(poly).map(([z, y]) => new THREE.Vector2(z, y));
    const tris = THREE.ShapeUtils.triangulateShape(c2, []);
    for (const [sx, snx] of [
      [x0, -1],
      [x1, 1],
    ]) {
      const G = new Geo();
      for (const v of c2) G.vert(sx, v.y, v.x, snx, 0, 0, v.x, v.y);
      for (const [a, bb, c] of tris) G.triO(a, bb, c, snx, 0, 0);
      b.add(G.toGeometry(), sideMat, sideSurf, { matrix, cast: sideCast });
    }
  }
  if (caps) {
    const capQuad = (z, y, dirZ) => {
      const G = new Geo();
      const a = G.vert(x0, 0, z, 0, 0, dirZ, x0, 0);
      G.vert(x1, 0, z, 0, 0, dirZ, x1, 0);
      G.vert(x1, y, z, 0, 0, dirZ, x1, y);
      G.vert(x0, y, z, 0, 0, dirZ, x0, y);
      G.quadO(a, a + 1, a + 2, a + 3, 0, 0, dirZ);
      b.add(G.toGeometry(), capMat, capSurf, { matrix });
    };
    if (first[1] > EPS) {
      const dz = prof[1][0] - first[0];
      capQuad(first[0], first[1], dz >= 0 ? -1 : 1);
    }
    if (last[1] > EPS) {
      const dz = last[0] - prof[prof.length - 2][0];
      capQuad(last[0], last[1], dz >= 0 ? 1 : -1);
    }
  }
}

// ---------------- closed-curve sweeps (bowls, pyramids) ----------------
// Rounded rectangle centered at origin with half extents hx,hz and per-corner radii
// [++, -+, --, +-]. Returns [{x,z,nx,nz}] with outward normals. maxSeg subdivides straight edges.
export function roundedRect(hx, hz, radii, segsPer90 = 24, maxSeg = 3) {
  const R = Array.isArray(radii) ? radii : [radii, radii, radii, radii];
  const corners = [
    [1, 1, 0],
    [-1, 1, Math.PI / 2],
    [-1, -1, Math.PI],
    [1, -1, (3 * Math.PI) / 2],
  ];
  const out = [];
  for (let c = 0; c < 4; c++) {
    const [sx, sz, a0] = corners[c];
    const r = R[c];
    const cx = sx * (hx - r);
    const cz = sz * (hz - r);
    for (let i = 0; i <= segsPer90; i++) {
      const a = a0 + ((Math.PI / 2) * i) / segsPer90;
      out.push({ x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r, nx: Math.cos(a), nz: Math.sin(a) });
    }
    // straight edge to next corner
    const [nsx, nsz, na0] = corners[(c + 1) % 4];
    const nr = R[(c + 1) % 4];
    const ex = nsx * (hx - nr) + Math.cos(na0) * nr;
    const ez = nsz * (hz - nr) + Math.sin(na0) * nr;
    const last = out[out.length - 1];
    const len = Math.hypot(ex - last.x, ez - last.z);
    const k = Math.floor(len / maxSeg);
    for (let i = 1; i <= k; i++) {
      const t = i / (k + 1);
      out.push({ x: last.x + (ex - last.x) * t, z: last.z + (ez - last.z) * t, nx: last.nx, nz: last.nz });
    }
  }
  return dedupeCurve(out);
}

function dedupeCurve(c) {
  const o = [];
  for (const p of c) {
    const q = o[o.length - 1];
    if (q && Math.abs(q.x - p.x) < 1e-6 && Math.abs(q.z - p.z) < 1e-6) {
      continue;
    }
    o.push(p);
  }
  const f = o[0];
  const l = o[o.length - 1];
  if (Math.abs(f.x - l.x) < 1e-6 && Math.abs(f.z - l.z) < 1e-6) o.pop();
  return o;
}

// Sweep a 2D profile [[d, y]] along a closed curve: P = curve + n*d, height y.
// Air-side normal derived analytically. j0..j1 = profile index range to emit.
export function sweep(b, curve, prof, { mat, surf, j0 = 0, j1 = prof.length - 1, matrix = null, vOrigin = 0 } = {}) {
  const N = curve.length;
  // profile tangents
  const tan = [];
  for (let j = 0; j < prof.length; j++) {
    const A = prof[Math.max(0, j - 1)];
    const B = prof[Math.min(prof.length - 1, j + 1)];
    let dd = B[0] - A[0];
    let dy = B[1] - A[1];
    const l = Math.hypot(dd, dy) || 1;
    tan.push([dd / l, dy / l]);
  }
  const vArc = [0];
  for (let j = 1; j < prof.length; j++) vArc.push(vArc[j - 1] + Math.hypot(prof[j][0] - prof[j - 1][0], prof[j][1] - prof[j - 1][1]));
  const G = new Geo();
  const rows = j1 - j0 + 1;
  const cols = N + 1;
  for (let j = j0; j <= j1; j++) {
    const [d, y] = prof[j];
    const [dd, dy] = tan[j];
    let u = 0;
    let px = 0;
    let pz = 0;
    for (let i = 0; i < cols; i++) {
      const c = curve[i % N];
      const x = c.x + c.nx * d;
      const z = c.z + c.nz * d;
      if (i > 0) u += Math.hypot(x - px, z - pz);
      px = x;
      pz = z;
      let nx = -dy * c.nx;
      let ny = dd;
      let nz = -dy * c.nz;
      const l = Math.hypot(nx, ny, nz) || 1;
      G.vert(x, y, z, nx / l, ny / l, nz / l, u, vArc[j] - vOrigin);
    }
  }
  for (let r = 0; r < rows - 1; r++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = r * cols + i;
      const bb = a + 1;
      const c = a + cols + 1;
      const d = a + cols;
      const hx = G.n[a * 3] + G.n[c * 3];
      const hy = G.n[a * 3 + 1] + G.n[c * 3 + 1];
      const hz = G.n[a * 3 + 2] + G.n[c * 3 + 2];
      G.quadO(a, bb, c, d, hx, hy, hz);
    }
  }
  b.add(G.toGeometry(), mat, surf, { matrix });
}

// Points of curve offset by d at height y (as Vector3s).
export function curveRing(curve, d, y) {
  return curve.map((c) => new THREE.Vector3(c.x + c.nx * d, y, c.z + c.nz * d));
}

// Generic "lathe" helper producing a merged geometry around Y from [r, y] pairs
export function lathe(pts, segs = 16) {
  const g = new THREE.LatheGeometry(
    pts.map(([r, y]) => new THREE.Vector2(r, y)),
    segs
  );
  return g;
}
