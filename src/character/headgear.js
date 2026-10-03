// Hair (+ eyebrows + facial hair), headwear and eyewear. Rigid meshes parented to the head bone.
// All geometry is generated in head-centred coordinates (x left, y up, z forward) then offset by dims.headC.
import * as THREE from 'three';
import { Part, gridPart, spherePart, pathTubePart, buildGeometry, fromGeometry, flipPart, computeNormals } from './geometry.js';
import { headSurface, headNormal, facePoint } from './body.js';
import { smoothstep, clamp, rng } from './util.js';
import { paintHair, makeCanvas, toTexture, paintFabric, region, shade, luminance, mixHex, stitch } from './textures.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _n = new THREE.Vector3();

function track(store, geo, mat, ...texs) {
  store.geos.push(geo);
  if (Array.isArray(mat)) store.mats.push(...mat);
  else store.mats.push(mat);
  for (const t of texs) if (t) store.texs.push(t);
}

// --------------------------------------------------------------- hat regions (unit-direction space)
// plane: dot(d, n) > c  is covered by the hat.  inner = clearance from the skull.
function hatPlane(frontY, backY) {
  // solve n=(0,ny,nz) with front point (0,frontY,fz) and back (0,backY,-bz) on the plane
  const fz = Math.sqrt(1 - frontY * frontY);
  const bz = Math.sqrt(1 - backY * backY);
  // frontY*ny + fz*nz = c ; backY*ny - bz*nz = c
  const nz = (-(frontY - backY) / (fz + bz));
  const n = V(0, 1, nz).normalize();
  const c = frontY * n.y + fz * n.z;
  return { n, c };
}
export const HAT_SPEC = {
  beanie: { ...hatPlane(0.42, -0.12), inner: 0.008 },
  cap: { ...hatPlane(0.42, 0.02), inner: 0.007 },
  capBack: { ...hatPlane(0.42, 0.02), inner: 0.007, back: true },
  bucket: { ...hatPlane(0.36, 0.0), inner: 0.01 },
  helmet: { ...hatPlane(0.5, -0.38), inner: 0.02 },
};

function hairlineY(d, style) {
  const a = Math.abs(Math.atan2(d.x, d.z));
  const keys = [
    [0, 0.44], [0.6, 0.41], [1.0, 0.27], [1.28, 0.05], [1.4, -0.2], [1.5, 0.27], [1.85, 0.3], [2.15, -0.12], [2.6, -0.38], [3.15, -0.5],
  ];
  let i = 0;
  while (i < keys.length - 2 && a > keys[i + 1][0]) i++;
  const k0 = keys[i];
  const k1 = keys[i + 1];
  const t = clamp((a - k0[0]) / (k1[0] - k0[0]));
  let y = k0[1] + (k1[1] - k0[1]) * t;
  if (style === 'swoop' && d.z > 0) y -= 0.22 * smoothstep(0.2, -0.6, d.x / Math.max(0.2, Math.hypot(d.x, d.z))) * smoothstep(0.2, 0.8, d.z);
  if (style === 'long' || style === 'braids') y -= 0.08 * smoothstep(1.9, 2.4, a);
  return y;
}

function lumps(d, f, seed) {
  return (
    Math.sin(d.x * f + seed) * Math.sin(d.y * f * 1.1 + seed * 2) * Math.sin(d.z * f * 0.9 + seed * 3) +
    0.5 * Math.sin(d.x * f * 2.1 + 1.3) * Math.sin(d.y * f * 1.9 + 0.7) * Math.sin(d.z * f * 2.3 + 2.1)
  );
}

/** thickness of the hair shell (meters, canonical) for unit direction d */
function hairThickness(d, style) {
  if (style === 'bald') return 0;
  const yt = hairlineY(d, style);
  const m = smoothstep(yt - 0.05, yt + 0.07, d.y);
  if (m <= 0) return 0;
  let t = 0;
  switch (style) {
    case 'buzz':
      t = 0.0028;
      break;
    case 'short':
      t = 0.009 + 0.008 * smoothstep(0.1, 0.8, d.y) + 0.004 * lumps(d, 9, 1) * smoothstep(0.0, 0.6, d.y);
      break;
    case 'swoop': {
      const front = smoothstep(-0.2, 0.7, d.z);
      t = 0.009 + 0.016 * smoothstep(0.2, 0.75, d.y) * (0.4 + 0.6 * front) + 0.006 * front * smoothstep(0.3, 0.6, d.y) * smoothstep(0.5, -0.5, d.x);
      t += 0.002 * lumps(d, 7, 2);
      break;
    }
    case 'long':
      t = 0.01 + 0.006 * smoothstep(0.2, 0.9, d.y);
      break;
    case 'bun':
      t = 0.0055;
      break;
    case 'curly':
      t = 0.034 + 0.01 * lumps(d, 11, 3) + 0.008 * smoothstep(0.3, 0.9, d.y) - 0.015 * smoothstep(0.55, 0.95, d.z) * smoothstep(0.6, 0.2, d.y);
      break;
    case 'mohawk': {
      const band = 1 - smoothstep(0.1, 0.24, Math.abs(d.x));
      t = 0.0018 + band * (0.05 * smoothstep(-0.5, 0.4, d.y) * (0.75 + 0.25 * Math.sin(d.z * 18)));
      break;
    }
    case 'braids':
      t = 0.005;
      break;
    default:
      t = 0.01;
  }
  return t * m;
}

const _d = new THREE.Vector3();

export function buildHair(rig, app, store) {
  const dims = rig.dims;
  const R = dims.headR;
  const k = dims.k;
  const style = app.hairStyle;
  const hat = app.headwear && app.headwear !== 'none' ? HAT_SPEC[app.headwear] : null;
  const parts = [];
  const rand = rng(5);
  // scalp shell
  if (style !== 'bald') {
    const shell = spherePart(64, 44, (d, u, v, out, o) => {
      headSurface(d, R, out, true);
      let t = hairThickness(d, style) * k;
      if (hat) {
        const cov = smoothstep(hat.c - 0.06, hat.c + 0.02, d.dot(hat.n));
        t = t * (1 - cov) + Math.min(t, (hat.inner - 0.004) * k) * cov;
      }
      // sink uncovered areas below the skin
      const yt = hairlineY(d, style);
      const m = smoothstep(yt - 0.05, yt + 0.07, d.y);
      const off = t > 0 ? t + 0.0008 * k : -0.003 * k * (1 - m);
      headNormal(d, R, _n);
      out.addScaledVector(_n, off - (m < 0.02 ? 0.002 * k : 0));
      o.u = u * 4;
      o.v = v * 2;
    });
    parts.push(shell);
  }
  // long drape
  if (style === 'long') {
    const nu = 28;
    const nv = 10;
    const len = 0.2 * k;
    const drape = gridPart(nu, nv, (i, j, o) => {
      const a = Math.PI + (i / nu - 0.5) * 2 * 2.05; // around the back
      const s = j / nv;
      const side = Math.abs(i / nu - 0.5) * 2; // 0 back .. 1 front edge
      const d = _d.set(Math.sin(a), 0.15, Math.cos(a)).normalize();
      const base = headSurface(d, R, new THREE.Vector3(), true);
      const rr = Math.hypot(base.x, base.z) + 0.012 * k;
      const L = len * (1 - 0.35 * side ** 2) * (1 + 0.08 * Math.sin(i * 2.7));
      const y = base.y - s * L;
      const flare = 1 + 0.18 * s + 0.08 * s * s;
      o.p.set(Math.sin(a) * rr * flare, y, Math.cos(a) * rr * flare * (a > Math.PI * 0.5 && a < Math.PI * 1.5 ? 1.05 : 1));
      o.u = i / nu * 4;
      o.v = 1 - s;
    }, { orient: 'auto', center: V(0, -0.1 * k, 0) });
    parts.push(drape);
  }
  // bun
  if (style === 'bun' && !(hat && !hat.back && app.headwear !== 'capBack')) {
    const d = V(0, 0.72, -0.69).normalize();
    const c = headSurface(d, R, new THREE.Vector3(), true).addScaledVector(headNormal(d, R, _n), 0.03 * k);
    const bun = spherePart(18, 12, (dd, u, v, out, o) => {
      out.copy(dd).multiplyScalar(0.034 * k * (1 + 0.06 * Math.sin(dd.x * 9) * Math.sin(dd.y * 7))).add(c);
      o.u = u * 2;
      o.v = v;
    });
    parts.push(bun);
  }
  // braids
  if (style === 'braids') {
    for (let b = 0; b < 8; b++) {
      const a = Math.PI + (b / 7 - 0.5) * 2 * 1.75;
      const d = V(Math.sin(a), -0.05, Math.cos(a)).normalize();
      const start = headSurface(d, R, new THREE.Vector3(), true).addScaledVector(headNormal(d, R, _n), 0.004 * k);
      const pts = [];
      const out = V(Math.sin(a), 0, Math.cos(a));
      const L = (0.26 + 0.04 * rand()) * k;
      for (let i = 0; i <= 14; i++) {
        const s = i / 14;
        pts.push(start.clone().addScaledVector(out, 0.03 * k * Math.sin(s * 1.6)).add(V(0, -s * L, 0)));
      }
      const br = pathTubePart(pts, (t) => (0.0085 + 0.003 * Math.abs(Math.sin(t * Math.PI * 9))) * k * (t > 0.95 ? 0.6 : 1), 7);
      for (let i = 0; i < br.uv.length; i += 2) br.uv[i] *= 0.5;
      parts.push(br);
    }
  }
  // eyebrows
  for (const side of [1, -1]) {
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const s = i / 8;
      const x = (0.011 + 0.043 * s) * k;
      const y = (0.025 + 0.009 * Math.sin(s * Math.PI * 0.85) - 0.003 * s) * k;
      pts.push(facePoint(R, x * side, y, new THREE.Vector3(), 0.0018 * k));
    }
    const br = pathTubePart(pts, (t) => (0.0042 - 0.0022 * t) * k * (t > 0.92 ? 0.6 : 1) * (t < 0.04 ? 0.7 : 1), 6);
    // flatten against the face: scale the offset from the path along the forward axis
    parts.push(br);
  }
  // facial hair
  if (app.facialHair === 'beard' || app.facialHair === 'mustache') {
    const full = app.facialHair === 'beard';
    const beard = spherePart(56, 40, (d, u, v, out, o) => {
      headSurface(d, R, out);
      const a = Math.abs(Math.atan2(d.x, d.z));
      const y = d.y;
      let m = 0;
      // mustache
      const must = (1 - smoothstep(0.32, 0.46, a)) * smoothstep(-0.62, -0.56, y) * (1 - smoothstep(-0.44, -0.38, y));
      m = Math.max(m, must);
      if (full) {
        const jawTop = -0.42 + 0.48 * smoothstep(0.55, 1.4, a); // up to sideburns near the ears
        const jaw = (1 - smoothstep(jawTop - 0.05, jawTop + 0.05, y)) * (1 - smoothstep(1.42, 1.55, a));
        const lips = (1 - smoothstep(0.26, 0.34, a)) * smoothstep(-0.72, -0.66, y) * (1 - smoothstep(-0.5, -0.45, y));
        m = Math.max(m, jaw * (1 - lips));
      }
      const t = (full ? 0.0085 + 0.004 * smoothstep(-0.6, -1, y) : 0.0045) * m * k;
      const off = m > 0.02 ? t + 0.0006 * k : -0.003 * k;
      out.addScaledVector(headNormal(d, R, _n), off);
      o.u = u * 4;
      o.v = v * 2;
    });
    parts.push(beard);
  }
  const geo = buildGeometry(parts, false);
  geo.translate(dims.headC.x, dims.headC.y, dims.headC.z);
  const tex = paintHair(app.hairColor, style);
  const c = new THREE.Color(app.hairColor);
  const mat = new THREE.MeshPhysicalMaterial({
    map: tex,
    roughness: 0.62,
    sheen: 0.8,
    sheenRoughness: 0.45,
    sheenColor: c.clone().lerp(new THREE.Color('#ffffff'), 0.4).multiplyScalar(0.55),
    side: THREE.DoubleSide,
  });
  track(store, geo, mat, tex);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'hair';
  return mesh;
}

// --------------------------------------------------------------- headwear
/** shell over the hat region; rows: [{th (0..1 of plane cap angle, may exceed 1), off}] */
function hatShell(R, k, plane, rows, nu, offFn) {
  const { n, c } = plane;
  const thMax = Math.acos(clamp(c, -1, 1));
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), n);
  const d = new THREE.Vector3();
  return gridPart(
    nu,
    rows.length - 1,
    (i, j, o) => {
      const r = rows[j];
      const th = r.th * thMax;
      const ph = -Math.PI + (2 * Math.PI * i) / nu;
      d.set(Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph)).applyQuaternion(q);
      headSurface(d, R, o.p, true);
      let off = r.off * k;
      if (offFn) off += offFn(d, th / thMax, ph, j) * k;
      o.p.addScaledVector(headNormal(d, R, _n), off);
      if (r.dy) o.p.y += r.dy * k;
      o.u = i / nu;
      o.v = r.v ?? 1 - j / (rows.length - 1);
    },
    { orient: 'auto', center: V(0, 0, 0) },
  );
}

function brimPart(edgeFn, nu, L, thick, droop, phRange) {
  // edgeFn(ph) -> {p: base point, out: outward horizontal dir}; closed flat brim with top & bottom surfaces
  const nv = 12;
  const part = gridPart(nu, nv, (i, j, o) => {
    const ph = phRange[0] + ((phRange[1] - phRange[0]) * i) / nu;
    const e = edgeFn(ph);
    const top = j <= nv / 2;
    const s = top ? j / (nv / 2) : (nv - j) / (nv / 2);
    const len = L(ph);
    const t = thick * Math.sin(Math.PI * clamp((ph - phRange[0]) / (phRange[1] - phRange[0]))) ** 0.3;
    o.p.copy(e.p).addScaledVector(e.out, s * len);
    o.p.y -= droop(ph, s) + (top ? 0 : t) - t * 0.5;
    o.u = 0.5 + 0.45 * Math.sin(ph) * 0.5;
    o.v = 0.05 + 0.1 * s;
  }, { orient: 'none' });
  // fix orientation: top surface normal should point up
  const k0 = (nu + 1) * 2 + Math.floor(nu / 2);
  if (part.nor[k0 * 3 + 1] < 0) flipPart(part);
  return part;
}

export function buildHeadwear(rig, app, store) {
  const type = app.headwear;
  if (!type || type === 'none') return null;
  const dims = rig.dims;
  const R = dims.headR;
  const k = dims.k;
  const spec = HAT_SPEC[type];
  const color = app.headwearColor;
  const parts = [];
  const cv = makeCanvas(512, 512);
  const ctx = cv.getContext('2d');
  let matOpts = { roughness: 0.9, sheen: 0.8 };
  if (type === 'beanie') {
    const rows = [];
    for (let j = 0; j <= 20; j++) rows.push({ th: j / 20 * 0.86, off: 0.0105 });
    // cuff: bulge out then tuck in
    rows.push({ th: 0.88, off: 0.019 });
    rows.push({ th: 0.95, off: 0.021 });
    rows.push({ th: 1.0, off: 0.02 });
    rows.push({ th: 1.03, off: 0.012 });
    rows.push({ th: 1.035, off: 0.0 });
    const shell = hatShell(R, k, spec, rows, 48, (d, t) => 0.016 * smoothstep(0.55, 0.0, t) * smoothstep(0.3, -0.6, d.z) + 0.004 * smoothstep(0.4, 0, t));
    for (let i = 1; i < shell.uv.length; i += 2) shell.uv[i] = 0.2 + shell.uv[i] * 0.8;
    parts.push(shell);
    paintFabric(ctx, null, region(cv, 0, 1, 0, 1, 0.55, 0.3), color, 'knit', 51);
    // cuff band slightly darker + small woven label
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(0, 512 * 0.73, 512, 512 * 0.27);
    ctx.fillStyle = luminance(color) > 0.5 ? '#202020' : '#f2f0ea';
    ctx.fillRect(512 * 0.47, 512 * 0.86, 512 * 0.06, 512 * 0.06);
  } else if (type === 'cap' || type === 'capBack' || type === 'bucket') {
    const bucket = type === 'bucket';
    const rows = [];
    for (let j = 0; j <= 18; j++) rows.push({ th: j / 18, off: bucket ? 0.012 : 0.0085 });
    rows.push({ th: 1.02, off: 0.0 });
    const shell = hatShell(R, k, spec, rows, 48, (d, t) => {
      // structured front panel (cap), flat top (bucket)
      if (bucket) return 0.012 * smoothstep(0.5, 0, t);
      return 0.01 * smoothstep(0.2, 0.9, d.z) * smoothstep(1.0, 0.5, t) + 0.003 * smoothstep(0.4, 0, t);
    });
    for (let i = 1; i < shell.uv.length; i += 2) shell.uv[i] = 0.2 + shell.uv[i] * 0.8;
    parts.push(shell);
    // brim
    const thMax = Math.acos(spec.c);
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), spec.n);
    const edgeFn = (ph) => {
      const d = V(Math.sin(thMax) * Math.sin(ph), Math.cos(thMax), Math.sin(thMax) * Math.cos(ph)).applyQuaternion(q);
      const p = headSurface(d, R, new THREE.Vector3(), true).addScaledVector(headNormal(d, R, _n), (bucket ? 0.01 : 0.008) * k);
      const out = V(p.x, 0, p.z).normalize();
      return { p, out };
    };
    if (bucket) {
      parts.push(brimPart(edgeFn, 56, () => 0.055 * k, 0.004 * k, (ph, s) => s * 0.03 * k + s * s * 0.006 * k, [-Math.PI, Math.PI]));
    } else {
      parts.push(
        brimPart(
          edgeFn,
          32,
          (ph) => 0.075 * k * Math.cos(clamp(ph / 1.25, -1, 1) * Math.PI * 0.5) ** 0.55,
          0.005 * k,
          (ph, s) => 0.012 * k * s + 0.014 * k * (ph / 1.2) ** 2 * s,
          [-1.25, 1.25],
        ),
      );
      // top button
      const btn = spherePart(10, 6, (d, u, v, out) => out.set(d.x * 0.007 * k, d.y * 0.003 * k, d.z * 0.007 * k));
      const top = headSurface(spec.n, R, new THREE.Vector3(), true).addScaledVector(spec.n, 0.013 * k);
      btn.translate(top.x, top.y, top.z);
      parts.push(btn);
    }
    paintFabric(ctx, null, region(cv, 0, 1, 0, 1, 0.6, 0.3), color, 'twill', 52);
    // panel seams radiating from the top (crown v ~ 1 at top)
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      const x = (i / 6) * 512;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 512 * 0.8);
      ctx.stroke();
    }
    // brim stitching rows (brim uv v 0.05-0.15)
    for (let r = 0; r < 5; r++) {
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(0, 512 * (0.86 + r * 0.02));
      ctx.lineTo(512, 512 * (0.86 + r * 0.02));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    if (!bucket) {
      // front logo (u = 0.5 front, crown v region ~0.45)
      ctx.save();
      ctx.translate(256, 512 * 0.5);
      ctx.scale(0.7, 1);
      ctx.font = 'italic 900 34px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = luminance(color) > 0.5 ? '#151515' : '#f2f0ea';
      ctx.fillText('SK8', 0, 0);
      ctx.restore();
    }
  } else if (type === 'helmet') {
    const rows = [];
    for (let j = 0; j <= 22; j++) rows.push({ th: j / 22, off: 0.026 });
    rows.push({ th: 1.0, off: 0.026, dy: -0.004 });
    rows.push({ th: 1.0, off: 0.012, dy: -0.005 });
    rows.push({ th: 0.98, off: 0.004 });
    const shell = hatShell(R, k, spec, rows, 56, (d, t) => 0.006 * smoothstep(0.6, 0, t));
    parts.push(shell);
    // chin straps
    for (const side of [1, -1]) {
      const pts = [
        V(side * R.x * 1.08, -0.01 * k, -0.005 * k),
        V(side * R.x * 0.98, -0.06 * k, 0.012 * k),
        V(side * R.x * 0.62, -0.112 * k, 0.03 * k),
        V(side * 0.004 * k, -0.128 * k, 0.04 * k),
      ];
      const s = pathTubePart(pts, () => 0.0028 * k, 5);
      for (let i = 0; i < s.uv.length; i += 2) {
        s.uv[i] = 0.02;
        s.uv[i + 1] = 0.02;
      }
      parts.push(s);
    }
    const W = 512;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, W, W);
    const g = ctx.createLinearGradient(0, 0, 0, W);
    g.addColorStop(0, 'rgba(255,255,255,0.1)');
    g.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, W);
    // vents (top)
    ctx.fillStyle = '#111';
    for (let i = 0; i < 8; i++) {
      const x = ((i + 0.5) / 8) * W;
      ctx.beginPath();
      ctx.ellipse(x, W * 0.12, 7, 22, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // rim stripe
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, W * 0.9, W, W * 0.1);
    ctx.fillRect(0, W * 0.97, 30, 30);
    // sticker
    ctx.save();
    ctx.translate(W * 0.25, W * 0.5);
    ctx.font = 'italic 900 30px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = luminance(color) > 0.5 ? '#151515' : '#f2f0ea';
    ctx.fillText('SK8.IO', 0, 0);
    ctx.restore();
    matOpts = { roughness: 0.32, sheen: 0, clearcoat: 0.7 };
  }
  const geo = buildGeometry(parts, false);
  if (spec.back) geo.rotateY(Math.PI);
  geo.translate(dims.headC.x, dims.headC.y, dims.headC.z);
  const tex = toTexture(cv);
  const c = new THREE.Color(color);
  const mat = new THREE.MeshPhysicalMaterial({
    map: tex,
    roughness: matOpts.roughness,
    sheen: matOpts.sheen,
    sheenRoughness: 0.7,
    sheenColor: c.clone().lerp(new THREE.Color('#fff'), 0.3).multiplyScalar(0.45),
    clearcoat: matOpts.clearcoat || 0,
    clearcoatRoughness: 0.2,
    side: THREE.DoubleSide,
  });
  track(store, geo, mat, tex);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'headwear';
  return mesh;
}

// --------------------------------------------------------------- eyewear
function roundedRectPts(w, h, r, n = 40) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    // superellipse outline
    const c = Math.cos(a);
    const s = Math.sin(a);
    const e = 2 / r;
    pts.push([Math.sign(c) * Math.abs(c) ** e * w * 0.5, Math.sign(s) * Math.abs(s) ** e * h * 0.5]);
  }
  return pts;
}

export function buildEyewear(rig, app, store) {
  const type = app.eyewear;
  if (!type || type === 'none') return null;
  const dims = rig.dims;
  const R = dims.headR;
  const k = dims.k;
  const sun = type === 'sunglasses';
  const lw = (sun ? 0.054 : 0.047) * k;
  const lh = (sun ? 0.04 : 0.033) * k;
  const z0 = 0.1 * k;
  const ey = 0.006 * k;
  const frameParts = [];
  const lensParts = [];
  const wrap = (x) => -1.6 * x * x; // z offset for wrap
  for (const side of [1, -1]) {
    const cx = side * 0.033 * k;
    const outline = roundedRectPts(lw, lh, sun ? 3.2 : 4, 44).map(([x, y]) => {
      const yy = y - (sun ? 0.004 * k * (x * side > 0 ? 1 : 0) : 0); // slight aviator droop outward
      return V(cx + x, ey + yy, z0 + wrap(cx + x));
    });
    outline.push(outline[0].clone());
    frameParts.push(pathTubePart(outline, () => (sun ? 0.0032 : 0.0024) * k, 6));
    // lens: fan from the centre
    const lens = new Part();
    const c = V(cx, ey, z0 + wrap(cx) - 0.001 * k);
    lens.pos.push(c.x, c.y, c.z);
    lens.uv.push(0.5, 0.5);
    for (const p of outline) {
      lens.pos.push(p.x, p.y, p.z - 0.001 * k);
      lens.uv.push(0.5, 0.5);
    }
    for (let i = 1; i < outline.length; i++) lens.idx.push(0, i, i + 1 > outline.length ? 1 : i + 1);
    computeNormals(lens);
    // normals forward
    if (lens.nor[2] < 0) flipPart(lens);
    lensParts.push(lens);
  }
  // bridge
  {
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const s = i / 8;
      const x = (-0.5 + s) * 0.022 * k;
      pts.push(V(x, ey + lh * 0.25 + 0.004 * k * Math.sin(s * Math.PI), z0 + 0.002 * k));
    }
    frameParts.push(pathTubePart(pts, () => 0.0024 * k, 6));
  }
  // temples back to the ears
  for (const side of [1, -1]) {
    const x0 = side * (0.033 * k + lw * 0.5);
    const pts = [
      V(x0, ey + lh * 0.3, z0 + wrap(x0) - 0.002 * k),
      V(side * (R.x * 1.07), ey + lh * 0.25, 0.06 * k),
      V(side * (R.x * 1.08), ey + 0.002 * k, 0.0),
      V(side * (R.x * 1.04), ey - 0.012 * k, -0.022 * k),
    ];
    const curve = new THREE.CatmullRomCurve3(pts);
    frameParts.push(pathTubePart(curve.getPoints(14), () => 0.0022 * k, 5));
  }
  for (const p of frameParts) p.group = 0;
  for (const p of lensParts) p.group = 1;
  const geo = buildGeometry([...frameParts, ...lensParts], false);
  geo.translate(dims.headC.x, dims.headC.y, dims.headC.z);
  const frameMat = new THREE.MeshPhysicalMaterial({ color: sun ? '#141414' : '#2a1d16', roughness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.15 });
  const lensMat = sun
    ? new THREE.MeshPhysicalMaterial({ color: '#0d1014', roughness: 0.05, metalness: 0.4, clearcoat: 1, side: THREE.DoubleSide })
    : new THREE.MeshPhysicalMaterial({ color: '#dfe8ee', roughness: 0.05, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false });
  track(store, geo, [frameMat, lensMat]);
  const mesh = new THREE.Mesh(geo, [frameMat, lensMat]);
  mesh.name = 'eyewear';
  return mesh;
}
