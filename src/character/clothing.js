// Clothing: tops (tee, longsleeve, hoodie, flannel, tank, coach jacket), bottoms (jeans, slim, chinos, cargo, shorts)
// and shoes (cupsole, vulc, hightop) + socks. All skinned to the shared skeleton, built in bind space.
import * as THREE from 'three';
import { BI } from './rig.js';
import { Part, tubePart, spherePart, pathTubePart, blendW, buildGeometry } from './geometry.js';
import { W1, armRings, armRadius, legRings, legRadius } from './body.js';
import { smoothstep, clamp, rng } from './util.js';
import {
  makeCanvas, toTexture, region, paintFabric, paintGraphic, stitch, seam, shade, mixHex, luminance, rgba,
} from './textures.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function interpKeys(keys, t) {
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
  const a = keys[i];
  const b = keys[i + 1];
  // smooth cosine interpolation between keys + catmull-ish neighbour influence
  const u = clamp((t - a[0]) / (b[0] - a[0]));
  const s = u * u * (3 - 2 * u);
  const lin = u;
  const m = 0.5; // blend between linear (no flats) and smooth
  const f = s * m + lin * (1 - m);
  return a.map((v, n) => v + (b[n] - v) * f);
}

function clothMaterial(tex, bump, color, o = {}) {
  const c = new THREE.Color(color);
  return new THREE.MeshPhysicalMaterial({
    map: tex,
    bumpMap: bump || null,
    bumpScale: o.bumpScale ?? 0.6,
    roughness: o.roughness ?? 0.88,
    metalness: 0,
    sheen: o.sheen ?? 0.8,
    sheenRoughness: o.sheenRoughness ?? 0.65,
    sheenColor: c.clone().lerp(new THREE.Color('#ffffff'), 0.35).multiplyScalar(o.sheenMul ?? 0.45),
    clearcoat: o.clearcoat ?? 0,
    clearcoatRoughness: 0.5,
  });
}

function track(store, geo, mat, ...texs) {
  store.geos.push(geo);
  store.mats.push(mat);
  for (const t of texs) if (t) store.texs.push(t);
}

// ======================================================================= TOPS
const TOP_SPEC = {
  tee: { loose: 0.011, hem: 0.8, sleeve: 'short', fabric: 'jersey', hemFlare: 0.012 },
  longsleeve: { loose: 0.009, hem: 0.8, sleeve: 'long', fabric: 'jersey', hemFlare: 0.01 },
  hoodie: { loose: 0.024, hem: 0.82, sleeve: 'long', fabric: 'fleece', hemFlare: -0.004, cuff: true },
  flannel: { loose: 0.017, hem: 0.78, sleeve: 'long', fabric: 'plaid', hemFlare: 0.014, collar: true },
  tank: { loose: 0.007, hem: 0.81, sleeve: 'none', fabric: 'jersey', hemFlare: 0.01 },
  jacket: { loose: 0.028, hem: 0.835, sleeve: 'long', fabric: 'nylon', hemFlare: -0.006, collar: true, cuff: true, pw: 2.6 },
};

// body torso keys: y, rx, rzF, rzB, cz  (canonical meters)
const TORSO = [
  [0.76, 0.172, 0.112, 0.124, -0.006],
  [0.84, 0.168, 0.108, 0.12, -0.006],
  [0.93, 0.163, 0.102, 0.11, -0.003],
  [1.02, 0.152, 0.1, 0.1, 0.002],
  [1.1, 0.15, 0.103, 0.095, 0.004],
  [1.2, 0.16, 0.112, 0.097, 0.002],
  [1.29, 0.172, 0.118, 0.102, -0.003],
  [1.36, 0.183, 0.116, 0.106, -0.008],
  [1.41, 0.19, 0.104, 0.104, -0.014],
  [1.445, 0.178, 0.086, 0.088, -0.02],
  [1.472, 0.125, 0.07, 0.072, -0.022],
  [1.492, 0.072, 0.063, 0.063, -0.02],
];

function torsoWeights(rig, y) {
  const k = rig.dims.k;
  const t = y / k;
  if (t < 1.06) return blendW(W1('pelvis'), W1('spine'), smoothstep(0.98, 1.08, t));
  if (t < 1.27) return blendW(W1('spine'), W1('chest'), smoothstep(1.16, 1.27, t));
  return W1('chest');
}

export function buildTop(rig, app, store) {
  const spec = TOP_SPEC[app.top] || TOP_SPEC.tee;
  const d = rig.dims;
  const k = d.k;
  const G = d.girth;
  const parts = [];
  const rings = [];
  const yTop = TORSO[TORSO.length - 1][0];
  const n = 30;
  const isTank = app.top === 'tank';
  for (let j = 0; j <= n; j++) {
    // denser sampling near the shoulders
    const u = j / n;
    const t = spec.hem + (yTop - spec.hem) * (1 - (1 - u) * (1 - u) * 0.0 - 0) * u ** 0.85;
    const [y, rx0, rzF0, rzB0, cz] = interpKeys(TORSO, t);
    let L = spec.loose;
    const nearHem = 1 - smoothstep(spec.hem, spec.hem + 0.1, y);
    L += spec.hemFlare * nearHem;
    const nearCollar = smoothstep(1.44, yTop, y);
    L *= 1 - 0.75 * nearCollar;
    let rx = rx0 * G + L;
    // tank: narrow straps region near the shoulders
    if (isTank) rx = Math.min(rx, (0.16 - 0.03 * smoothstep(1.4, 1.47, y)) * G + L);
    rings.push({
      c: V(0, y * k, cz * k),
      ax: V(1, 0, 0),
      az: V(0, 0, 1),
      rx: rx * k,
      rzF: (rzF0 * G + L) * k,
      rzB: (rzB0 * G + L) * k,
      pw: spec.pw ?? 2.3,
      y: y * k,
    });
  }
  // hem turned inward a little (closes the tube visually)
  {
    const r0 = rings[0];
    rings.unshift({ ...r0, c: r0.c.clone().add(V(0, 0.004 * k, 0)), rx: r0.rx - 0.012 * k, rzF: r0.rzF - 0.012 * k, rzB: r0.rzB - 0.012 * k });
  }
  // collar: hug the neck
  {
    const rl = rings[rings.length - 1];
    const nr = 0.056 * k * (0.92 + 0.12 * d.b);
    rings.push({ ...rl, c: rl.c.clone().add(V(0, 0.003 * k, 0.004 * k)), rx: nr + 0.003 * k, rzF: nr + 0.002 * k, rzB: nr, pw: 2 });
  }
  const shoulderSide = (X) => (X > 0 ? 'upperArmL' : 'upperArmR');
  const torso = tubePart(rings, 40, {
    u0: 1,
    u1: 0,
    v0: 0.3,
    v1: 1.0,
    wfn: (th, j, r, X, Z) => {
      const base = torsoWeights(rig, r.c.y);
      const sh = smoothstep(1.35 * k, 1.43 * k, r.c.y) * smoothstep(0.55, 0.9, Math.abs(X)) * 0.35;
      return sh > 0 ? blendW(base, W1(shoulderSide(X)), sh) : base;
    },
    disp: (th, j, r) => {
      // hoodie kangaroo pocket bulge, subtle fabric folds near the waist
      let dd = 0;
      const s = Math.sin(th);
      if (app.top === 'hoodie' && s > 0.3) dd += 0.007 * k * smoothstep(0.3, 0.6, s) * smoothstep(0.86 * k, 0.92 * k, r.c.y) * (1 - smoothstep(1.02 * k, 1.07 * k, r.c.y));
      dd += 0.0018 * k * Math.sin(th * 7 + r.c.y * 40) * (1 - smoothstep(0.9 * k, 1.1 * k, r.c.y));
      return dd;
    },
  });
  parts.push(torso);

  // chest/torso metric sizes for painting
  const chestRing = rings.reduce((best, r) => (Math.abs(r.c.y - 1.3 * k) < Math.abs(best.c.y - 1.3 * k) ? r : best), rings[0]);
  const perim = Math.PI * (chestRing.rx + (chestRing.rzF + chestRing.rzB) / 2);
  let totalLen = 0;
  const cumAt = [];
  for (let j = 0; j < rings.length; j++) {
    if (j) totalLen += rings[j].c.distanceTo(rings[j - 1].c) + 1e-6;
    cumAt.push(totalLen);
  }
  const vAt = (y) => {
    let best = 0;
    for (let j = 0; j < rings.length; j++) if (Math.abs(rings[j].c.y - y) < Math.abs(rings[best].c.y - y)) best = j;
    return cumAt[best];
  };

  // sleeves
  let sleeveLen = 0;
  if (spec.sleeve !== 'none') {
    const L = d.upperArm + d.forearm;
    const sEnd = spec.sleeve === 'short' ? 0.2 * k : L - 0.005 * k;
    sleeveLen = sEnd + 0.065 * k;
    const loose = spec.loose * 0.9 + 0.004;
    const sl = armRings(rig, -0.065 * k, sEnd, (s) => {
      const r = armRadius(d, s);
      const add = (s < 0 ? Math.sqrt(Math.max(0, 1 - (s / (0.065 * k)) ** 2)) : 1) * (loose * k + (spec.sleeve === 'short' ? 0.012 * k * smoothstep(0.05 * k, 0.18 * k, s) : 0));
      // dome: use outer radius shape
      const dome = s < 0 ? Math.sqrt(Math.max(0, 1 - (s / (0.065 * k)) ** 2)) : 1;
      const base = s < 0 ? 0.052 * k * d.limbG * dome : r.r;
      let rr = base + add;
      if (spec.cuff && s > sEnd - 0.06 * k) rr = Math.min(rr, armRadius(d, s).r + 0.007 * k);
      return { r: rr, rx: rr * 0.97, rzF: rr * 0.98, rzB: rr };
    }, 28);
    // hem: fold inward toward the arm
    const last = sl[sl.length - 1];
    const ar = armRadius(d, sEnd).r + 0.0015 * k;
    sl.push({ ...last, c: last.c.clone().addScaledVector(V(Math.sin(d.armBind), -Math.cos(d.armBind), 0), -0.004 * k), rx: ar, rzF: ar, rzB: ar });
    const sleeve = tubePart(sl, 18, {
      v0: 0.06,
      v1: 0.28,
      disp: (th, j, r) => (spec.sleeve === 'long' ? 0.0022 * k * Math.sin(j * 1.3 + th * 2) * (j / sl.length) : 0),
    });
    parts.push(sleeve, sleeve.mirrored());
  }

  // hood + strings (hoodie)
  if (app.top === 'hoodie') {
    const hb = V(0, 1.43 * k, -0.115 * k - 0.01 * k * G);
    const hood = spherePart(22, 14, (dd, u, v, out, o) => {
      const back = Math.max(0, -dd.z);
      out.set(dd.x * 0.125 * k * (1 - 0.25 * Math.max(0, -dd.y)), dd.y * 0.085 * k, dd.z * 0.05 * k * (dd.z > 0 ? 0.5 : 1));
      // crease
      out.z -= 0.006 * k * Math.exp(-((dd.x * 3) ** 2)) * back;
      out.add(hb);
      o.u = u;
      o.v = 0.005 + v * 0.04;
    });
    hood.setWeights(blendW(W1('chest'), W1('neck'), 0.25));
    parts.push(hood);
    // hood rim around the neck
    const rim = [];
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const front = Math.max(0, Math.cos(a));
      rim.push(V(Math.sin(a) * 0.088 * k * G, (1.475 - 0.05 * front ** 3) * k, Math.cos(a) * 0.082 * k * G - 0.022 * k));
    }
    const rimPart = pathTubePart(rim, () => 0.016 * k, 8, { weights: blendW(W1('chest'), W1('neck'), 0.3) });
    for (let i = 1; i < rimPart.uv.length; i += 2) rimPart.uv[i] = 0.02;
    parts.push(rimPart);
    for (const sx of [1, -1]) {
      const p0 = V(sx * 0.03 * k, 1.44 * k, 0.07 * k + 0.03 * k * G);
      const pts = [];
      for (let i = 0; i <= 8; i++) pts.push(p0.clone().add(V(sx * 0.004 * i * k * 0.2, -i * 0.024 * k, 0.004 * k * Math.sin(i * 0.4))));
      const s = pathTubePart(pts, (t) => (t > 0.85 ? 0.0055 : 0.0035) * k, 6, { weights: W1('chest') });
      for (let i = 1; i < s.uv.length; i += 2) {
        s.uv[i - 1] = 0.9;
        s.uv[i] = 0.01;
      }
      parts.push(s);
    }
  }
  // collar (flannel / jacket)
  if (spec.collar) {
    const pts = [];
    for (let i = 0; i <= 28; i++) {
      const a = -Math.PI * 0.82 + (i / 28) * Math.PI * 1.64; // open at the front
      pts.push(V(Math.sin(a + Math.PI) * 0.074 * k * G, (1.482 + 0.012 * Math.cos(a)) * k, -Math.cos(a) * 0.068 * k * G - 0.02 * k));
    }
    const collar = new Part();
    // flattened band: two offset tubes approximated by an elliptical tube
    const c = pathTubePart(pts, () => 0.013 * k, 8, { weights: blendW(W1('chest'), W1('neck'), 0.35) });
    for (let i = 1; i < c.uv.length; i += 2) {
      c.uv[i - 1] = 0.3 + (i % 9) * 0.01;
      c.uv[i] = 0.02;
    }
    collar.append(c);
    parts.push(collar);
  }

  // ---------------------------------------------------------------- texture
  const cv = makeCanvas(1024, 1024);
  const bv = makeCanvas(512, 512);
  const ctx = cv.getContext('2d');
  const bctx = bv.getContext('2d');
  const color = app.topColor;
  const RT = region(cv, 0, 1, 0.3, 1, perim * 2, totalLen);
  const RTb = region(bv, 0, 1, 0.3, 1, perim * 2, totalLen);
  const RS = region(cv, 0, 1, 0.06, 0.28, 0.36 * k, Math.max(0.1, sleeveLen));
  const RSb = region(bv, 0, 1, 0.06, 0.28, 0.36 * k, Math.max(0.1, sleeveLen));
  const RX = region(cv, 0, 1, 0, 0.05, 0.6, 0.05);
  paintFabricPair(ctx, bctx, RT, RTb, color, spec.fabric, 11);
  paintFabricPair(ctx, bctx, RS, RSb, color, spec.fabric, 12);
  paintFabric(ctx, null, RX, app.top === 'hoodie' ? shade(color, -0.08) : color, spec.fabric, 13);
  const stitchCol = luminance(color) > 0.5 ? 'rgba(0,0,0,0.28)' : 'rgba(255,255,255,0.22)';
  const mw = RT.mw;
  const mh = RT.mh;
  RT.begin(ctx);
  // side seams (u = 0.25 / 0.75 of the flipped torso => x = mw*0.25, mw*0.75)
  for (const sx of [0.25, 0.75]) seamLine(ctx, [[sx * mw, 0], [sx * mw, mh]], 0.14);
  // hem
  if (app.top === 'hoodie' || app.top === 'jacket') {
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(0, 0, mw, 0.055 * k);
    for (let x = 0; x < mw; x += 0.006) {
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(x, 0, 0.002, 0.055 * k);
    }
  } else {
    stitch(ctx, [[0, 0.018], [mw, 0.018]], stitchCol);
    stitch(ctx, [[0, 0.024], [mw, 0.024]], stitchCol);
  }
  // collar rib band
  if (app.top === 'tee' || app.top === 'longsleeve' || app.top === 'tank') {
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.fillRect(0, mh - 0.022, mw, 0.022);
    stitch(ctx, [[0, mh - 0.026], [mw, mh - 0.026]], stitchCol);
  }
  const front = mw * 0.5;
  if (app.top === 'hoodie') {
    // kangaroo pocket
    const y0 = vAt(0.87 * k);
    const y1 = vAt(1.03 * k);
    const pw0 = 0.15 * k;
    const pw1 = 0.1 * k;
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 0.004;
    ctx.beginPath();
    ctx.moveTo(front - pw0, y0);
    ctx.lineTo(front - pw1, y1);
    ctx.lineTo(front + pw1, y1);
    ctx.lineTo(front + pw0, y0);
    ctx.stroke();
    stitch(ctx, [[front - pw0 + 0.008, y0], [front - pw1 + 0.008, y1 - 0.006], [front + pw1 - 0.008, y1 - 0.006], [front + pw0 - 0.008, y0]], stitchCol);
    // pocket openings
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 0.005;
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(front + sx * pw0, y0 + 0.01);
      ctx.lineTo(front + sx * pw1, y1 - 0.015);
      ctx.stroke();
    }
  }
  if (app.top === 'flannel' || app.top === 'jacket') {
    // placket + buttons / snaps
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.fillRect(front - 0.016, 0, 0.032, mh);
    seamLine(ctx, [[front + 0.016, 0], [front + 0.016, mh]], 0.25);
    stitch(ctx, [[front - 0.012, 0], [front - 0.012, mh]], stitchCol);
    for (let y = vAt(0.86 * k); y < mh - 0.03; y += 0.085 * k) {
      ctx.fillStyle = app.top === 'jacket' ? '#c9c9c9' : mixHex(color, '#f2ead8', 0.6);
      ctx.beginPath();
      ctx.arc(front, y, app.top === 'jacket' ? 0.0075 : 0.0055, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 0.0012;
      ctx.stroke();
    }
    if (app.top === 'flannel') {
      for (const sx of [-1, 1]) {
        const px = front + sx * 0.095 * k;
        const py = vAt(1.28 * k);
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 0.003;
        ctx.strokeRect(px - 0.05, py - 0.075, 0.1, 0.11);
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        ctx.fillRect(px - 0.052, py + 0.005, 0.104, 0.03);
        stitch(ctx, [[px - 0.046, py + 0.006], [px + 0.046, py + 0.006]], stitchCol);
      }
      // back yoke
      seamLine(ctx, [[0, mh - 0.13], [mw * 0.2, mh - 0.13]], 0.15);
      seamLine(ctx, [[mw * 0.8, mh - 0.13], [mw, mh - 0.13]], 0.15);
    }
  }
  if (app.top === 'tank') {
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.fillRect(0, mh - 0.06, mw, 0.06);
  }
  RT.end(ctx);
  // graphic (front chest)
  const gcol = app.topGraphicColor || '#c0392b';
  if (app.topGraphic && app.topGraphic !== 'none') {
    const gy = vAt((app.topGraphic === 'stripe' ? 1.25 : 1.29) * k);
    const size = (app.topGraphic === 'pocket' ? 0.2 : app.topGraphic === 'stripe' ? 0.22 : 0.2) * k;
    let gx = front;
    if (app.topGraphic === 'pocket') gx = front - 0.02 * k;
    paintGraphic(ctx, RT, app.topGraphic, gcol, color, gx, gy, size);
    // small back print for the logo
    if (app.topGraphic === 'logo') paintGraphic(ctx, RT, 'logo', gcol, color, 0.0 * mw + 0.001, vAt(1.36 * k), 0.08);
  }
  // sleeves detail
  RS.begin(ctx);
  seamLine(ctx, [[0.005, 0], [0.005, RS.mh]], 0.12);
  if (spec.sleeve === 'short') {
    stitch(ctx, [[0, RS.mh - 0.016], [RS.mw, RS.mh - 0.016]], stitchCol);
  } else if (spec.cuff || app.top === 'longsleeve') {
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.fillRect(0, RS.mh - 0.06 * k, RS.mw, 0.06 * k);
    for (let x = 0; x < RS.mw; x += 0.006) {
      ctx.fillStyle = 'rgba(0,0,0,0.1)';
      ctx.fillRect(x, RS.mh - 0.06 * k, 0.0022, 0.06 * k);
    }
  } else {
    // flannel cuff
    seamLine(ctx, [[0, RS.mh - 0.06], [RS.mw, RS.mh - 0.06]], 0.2);
    ctx.fillStyle = mixHex(color, '#f2ead8', 0.6);
    ctx.beginPath();
    ctx.arc(RS.mw * 0.5, RS.mh - 0.03, 0.005, 0, Math.PI * 2);
    ctx.fill();
  }
  // shoulder seam near the top of the sleeve
  seamLine(ctx, [[0, 0.07 * k], [RS.mw, 0.07 * k]], 0.12);
  RS.end(ctx);
  const tex = toTexture(cv);
  const bump = toTexture(bv, { srgb: false });
  const fabricOpts = {
    jersey: { roughness: 0.9, sheen: 0.7, bumpScale: 0.5 },
    fleece: { roughness: 0.95, sheen: 1.0, sheenRoughness: 0.8, bumpScale: 0.4 },
    plaid: { roughness: 0.9, sheen: 0.8, bumpScale: 0.7 },
    nylon: { roughness: 0.42, sheen: 0.25, clearcoat: 0.25, bumpScale: 0.2 },
  }[spec.fabric];
  const mat = clothMaterial(tex, bump, color, fabricOpts);
  const geo = buildGeometry(parts, true);
  track(store, geo, mat, tex, bump);
  return { geo, mat, sleeve: spec.sleeve, sleeveEnd: spec.sleeve === 'short' ? 0.2 * k : null };
}

function paintFabricPair(ctx, bctx, R, Rb, color, style, seed) {
  paintFabric(ctx, null, R, color, style, seed);
  // bump at lower resolution
  paintFabric(bctx.canvas.getContext('2d'), null, Rb, '#808080', style, seed);
}

function seamLine(ctx, pts, a = 0.18) {
  ctx.save();
  ctx.strokeStyle = `rgba(0,0,0,${a})`;
  ctx.lineWidth = 0.0035;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
  ctx.restore();
}

// ======================================================================= BOTTOMS
const BOTTOM_SPEC = {
  jeans: { fabric: 'denim', thigh: 0.02, knee: 0.03, hem: 0.032, hemY: 0.045, stack: 1 },
  slim: { fabric: 'denim', thigh: 0.006, knee: 0.008, hem: 0.012, hemY: 0.06, stack: 0.4 },
  chinos: { fabric: 'twill', thigh: 0.012, knee: 0.016, hem: 0.018, hemY: 0.055, stack: 0.5 },
  cargo: { fabric: 'twill', thigh: 0.024, knee: 0.03, hem: 0.03, hemY: 0.05, stack: 0.8, pockets: true },
  shorts: { fabric: 'twill', thigh: 0.03, knee: 0.035, hem: 0.035, hemY: 0.5, stack: 0 },
};

export function buildBottom(rig, app, store) {
  const spec = BOTTOM_SPEC[app.bottom] || BOTTOM_SPEC.jeans;
  const d = rig.dims;
  const k = d.k;
  const G = d.girth;
  const hip = rig.bindPos.thighL;
  const waistY = 1.045 * k;
  const crotchY = 0.8 * k;
  const hemY = spec.hemY * k;
  const n = 40;
  const rings = [];
  for (let j = 0; j <= n; j++) {
    const u = j / n;
    const y = waistY + (hemY - waistY) * u;
    const t = y / k;
    let rx;
    let rzF;
    let rzB;
    let cx;
    let cz = 0;
    // upper: half of the hips (two tubes meet at the centre seam)
    const upper = smoothstep(crotchY / k - 0.02, 0.98, t); // 1 at hips
    const leg = legRadius(d, Math.min(y, 0.9 * k));
    const ease = (spec.thigh + (spec.knee - spec.thigh) * smoothstep(0.75, 0.45, t) + (spec.hem - spec.knee) * smoothstep(0.45, 0.1, t)) * k;
    const legRx = leg.rx + ease;
    const legRzF = leg.rzF + ease;
    const legRzB = leg.rzB + ease;
    const hipsRx = (0.092 * G + 0.006) * k;
    const hipsRzF = (0.104 * G + 0.006) * k;
    const hipsRzB = (0.118 * G + 0.008) * k;
    rx = legRx + (hipsRx - legRx) * upper;
    rzF = legRzF + (hipsRzF - legRzF) * upper;
    rzB = legRzB + (hipsRzB - legRzB) * upper;
    cx = hip.x * (1 - 0.12 * upper) + 0.004 * k * (1 - upper);
    cz = -0.008 * k * upper;
    if (spec.stack && t < 0.2) {
      // stacking at the ankle
      const s = smoothstep(0.2, 0.06, t) * spec.stack;
      rx += 0.004 * k * s;
      rzF += 0.008 * k * s;
      rzB += 0.004 * k * s;
    }
    rings.push({ c: V(cx, y, hip.z + cz), ax: V(1, 0, 0), az: V(0, 0, 1), rx, rzF, rzB, pw: 2.15 });
  }
  // hem fold
  {
    const r = rings[rings.length - 1];
    const ir = spec.hemY > 0.3 ? 0.012 : 0.02;
    rings.push({ ...r, c: r.c.clone().add(V(0, 0.003 * k, 0)), rx: r.rx - ir * k, rzF: r.rzF - ir * k, rzB: r.rzB - ir * k });
  }
  const knee = rig.bindPos.shinL;
  const ank = rig.bindPos.footL;
  const wy = (y, X) => {
    let w;
    if (y > hip.y - 0.14 * k) {
      // inner side near the crotch stays with the pelvis longer
      const inner = X < 0 ? -X : 0;
      const a = smoothstep(hip.y + 0.08 * k, hip.y - 0.14 * k, y) * (1 - 0.35 * inner * smoothstep(crotchY - 0.1 * k, crotchY + 0.05 * k, y));
      w = blendW(W1('pelvis'), W1('thighL'), a);
    } else if (y > knee.y - 0.06 * k) w = blendW(W1('thighL'), W1('shinL'), smoothstep(knee.y + 0.06 * k, knee.y - 0.06 * k, y));
    else w = blendW(W1('shinL'), W1('footL'), 0.3 * smoothstep(ank.y + 0.03 * k, ank.y - 0.04 * k, y));
    return w;
  };
  const legPart = tubePart(rings, 28, {
    wfn: (th, j, r, X) => wy(r.c.y, X),
    disp: (th, j, r) => {
      let dd = 0;
      const y = r.c.y / k;
      // cargo pockets on the outer thigh
      if (spec.pockets) {
        const c = Math.cos(th);
        dd += 0.011 * k * smoothstep(0.55, 0.85, c) * smoothstep(0.5, 0.56, y) * (1 - smoothstep(0.7, 0.74, y));
      }
      // knee/ankle wrinkles
      dd += 0.0025 * k * Math.sin(th * 3 + y * 60) * smoothstep(0.62, 0.48, y) * smoothstep(0.32, 0.45, y);
      if (y < 0.18 && spec.stack) dd += 0.004 * k * spec.stack * Math.sin(y * 140 + Math.sin(th * 2) * 2) * smoothstep(0.18, 0.08, y);
      return dd;
    },
  });
  const parts = [legPart, legPart.mirrored()];

  // texture: both legs share UV (u: 0.5 front, 0.25 outer side)
  const cv = makeCanvas(512, 1024);
  const bv = makeCanvas(256, 512);
  const ctx = cv.getContext('2d');
  const color = app.bottomColor;
  let len = 0;
  for (let j = 1; j < rings.length; j++) len += rings[j].c.distanceTo(rings[j - 1].c);
  const perim = Math.PI * 2 * 0.1 * k * G;
  const R = region(cv, 0, 1, 0, 1, perim, len);
  const Rb = region(bv, 0, 1, 0, 1, perim, len);
  paintFabric(ctx, null, R, color, spec.fabric, 21);
  paintFabric(bv.getContext('2d'), null, Rb, '#808080', spec.fabric, 21);
  const mw = R.mw;
  // metric y: 0 = waist (top) .. len = hem
  const yOf = (yy) => (waistY - yy) * 1.0;
  const denim = spec.fabric === 'denim';
  const thread = denim ? 'rgba(214,150,70,0.85)' : luminance(color) > 0.5 ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.25)';
  R.begin(ctx);
  if (denim) {
    // fades: thighs front & knees lighter, creases darker
    const fade = (x, y, rw, rh, a) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(rw, rh);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };
    fade(mw * 0.5, yOf(0.72 * k), 0.07, 0.16, 0.16);
    fade(mw * 0.5, yOf(0.5 * k), 0.06, 0.06, 0.12);
    fade(mw * 0.0, yOf(0.85 * k), 0.08, 0.1, 0.1);
    for (let i = 0; i < 7; i++) {
      // whiskers at the hip front
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 0.004;
      ctx.beginPath();
      const y = yOf(0.86 * k) + i * 0.012;
      ctx.moveTo(mw * 0.5 - 0.06, y);
      ctx.quadraticCurveTo(mw * 0.5 - 0.02, y + 0.008, mw * 0.5 + 0.03, y - 0.01);
      ctx.stroke();
    }
  }
  // outseam / inseam
  seamLine(ctx, [[mw * 0.25, 0], [mw * 0.25, len]], 0.2);
  stitch(ctx, [[mw * 0.25 + 0.005, 0], [mw * 0.25 + 0.005, len]], thread);
  seamLine(ctx, [[mw * 0.75, yOf(0.78 * k)], [mw * 0.75, len]], 0.15);
  // waistband + belt loops
  ctx.fillStyle = 'rgba(0,0,0,0.1)';
  ctx.fillRect(0, 0, mw, 0.04 * k);
  stitch(ctx, [[0, 0.036 * k], [mw, 0.036 * k]], thread);
  for (const lx of [0.05, 0.3, 0.55, 0.8]) {
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(mw * lx, 0, 0.012, 0.05);
  }
  // front pocket curve
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 0.003;
  ctx.beginPath();
  ctx.moveTo(mw * 0.36, 0.04 * k);
  ctx.quadraticCurveTo(mw * 0.39, 0.12 * k, mw * 0.28, 0.13 * k);
  ctx.stroke();
  stitch(ctx, [[mw * 0.37, 0.04 * k], [mw * 0.38, 0.1 * k], [mw * 0.3, 0.125 * k]], thread);
  // fly (centre front of the left leg is u=0.5+? centre seam is the inner side at u≈0.75); draw J-stitch near the inner front
  stitch(ctx, [[mw * 0.62, 0.04 * k], [mw * 0.62, 0.17 * k], [mw * 0.68, 0.2 * k]], thread);
  // back pocket (u ~ 0.0/1.0 = back)
  const bp = (cx) => {
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 0.003;
    ctx.beginPath();
    ctx.moveTo(cx - 0.065, 0.08 * k);
    ctx.lineTo(cx + 0.065, 0.08 * k);
    ctx.lineTo(cx + 0.06, 0.2 * k);
    ctx.lineTo(cx, 0.225 * k);
    ctx.lineTo(cx - 0.06, 0.2 * k);
    ctx.closePath();
    ctx.stroke();
    stitch(ctx, [[cx - 0.06, 0.088 * k], [cx + 0.06, 0.088 * k]], thread);
  };
  bp(mw * 0.12);
  // cargo pocket flaps
  if (spec.pockets) {
    const top = yOf(0.74 * k);
    const bot = yOf(0.5 * k);
    ctx.fillStyle = 'rgba(0,0,0,0.06)';
    ctx.fillRect(mw * 0.15, top, mw * 0.2, bot - top);
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 0.003;
    ctx.strokeRect(mw * 0.15, top, mw * 0.2, bot - top);
    ctx.fillStyle = 'rgba(0,0,0,0.14)';
    ctx.fillRect(mw * 0.14, top - 0.005, mw * 0.22, 0.05);
    stitch(ctx, [[mw * 0.15, top + 0.042], [mw * 0.35, top + 0.042]], thread);
  }
  // hem stitch
  stitch(ctx, [[0, len - 0.02], [mw, len - 0.02]], thread);
  if (!denim) {
    // pressed crease down the front
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 0.004;
    ctx.beginPath();
    ctx.moveTo(mw * 0.5, yOf(0.9 * k));
    ctx.lineTo(mw * 0.5, len);
    ctx.stroke();
  }
  R.end(ctx);
  const tex = toTexture(cv);
  const bump = toTexture(bv, { srgb: false });
  const mat = clothMaterial(tex, bump, color, denim ? { roughness: 0.92, sheen: 0.5, bumpScale: 0.8 } : { roughness: 0.9, sheen: 0.6, bumpScale: 0.5 });
  const geo = buildGeometry(parts, true);
  track(store, geo, mat, tex, bump);
  return { geo, mat, shorts: spec.hemY > 0.3, hemY };
}

// ======================================================================= SHOES
const SHOE_SPEC = {
  cupsole: { sole: 0.032, toe: 0.036, instep: 0.072, collar: 0.052, width: 1.06, high: 0 },
  vulc: { sole: 0.022, toe: 0.032, instep: 0.066, collar: 0.048, width: 1.0, high: 0 },
  hightop: { sole: 0.028, toe: 0.034, instep: 0.07, collar: 0.05, width: 1.04, high: 1 },
};

export function buildShoes(rig, app, { socks }, store) {
  const spec = SHOE_SPEC[app.shoes] || SHOE_SPEC.cupsole;
  const d = rig.dims;
  const k = d.k;
  const sk = 0.96 + 0.08 * d.b; // shoe size with build
  const heel = -d.heel;
  const toe = d.toe;
  const bottom = -d.ankleH;
  const soleT = spec.sole * k;
  const L = toe - heel;
  const halfW = (z) => {
    const t = (z - heel) / L; // 0 heel .. 1 toe
    let w = 0.036 + 0.016 * smoothstep(0.05, 0.62, t) - 0.006 * smoothstep(0.72, 1, t);
    return w * k * sk * spec.width;
  };
  const endRound = (z, rad) => {
    const a = (z - heel) / rad;
    const b = (toe - z) / rad;
    const f = (x) => (x >= 1 ? 1 : Math.sqrt(Math.max(0, 1 - (1 - x) * (1 - x))));
    return f(clamp(a, 0, 1)) * f(clamp(b, 0, 1));
  };
  const medial = (z) => -0.006 * k * smoothstep(heel + L * 0.4, toe, z); // toe box drifts medially (-X for left)
  const parts = [];
  // ---- sole
  const nz = 36;
  {
    const rings = [];
    for (let j = 0; j <= nz; j++) {
      const z = heel - 0.004 * k + ((L + 0.008 * k) * j) / nz;
      const er = endRound(z, 0.045 * k) * 0.999 + 0.001;
      const w = (halfW(Math.min(toe, Math.max(heel, z))) + 0.004 * k) * er;
      const h = soleT * 0.5 * Math.max(0.35, er ** 0.4);
      // toe spring: the sole curves up at the toe
      const spring = 0.008 * k * smoothstep(toe - 0.06 * k, toe + 0.004 * k, z) ** 2;
      rings.push({ c: V(medial(z), bottom + soleT * 0.5 + spring, z), ax: V(1, 0, 0), az: V(0, 1, 0), rx: w, rzF: h, rzB: h, pw: 5 });
    }
    const sole = tubePart(rings, 32, { v0: 0.2, v1: 0.43 });
    // tubePart puts u=0.5 at +az (top). orientation check uses az -> fine.
    sole.setWeights(W1('footL'));
    parts.push(sole);
  }
  // ---- upper
  const top = bottom + soleT - 0.003 * k;
  {
    const rings = [];
    for (let j = 0; j <= nz; j++) {
      const z = heel + 0.003 * k + ((L - 0.012 * k) * j) / nz;
      const t = (z - heel) / L;
      const er = endRound(z, 0.05 * k);
      const w = halfW(z) * Math.max(0.05, er);
      // height profile: heel counter -> collar dip -> instep -> toe box
      let h = spec.collar + 0.012 * (1 - smoothstep(0.0, 0.12, t)) - 0.012 * smoothstep(0.1, 0.22, t) * (1 - smoothstep(0.22, 0.38, t));
      h = h + (spec.instep - spec.collar) * smoothstep(0.2, 0.38, t);
      h = h + (spec.toe - spec.instep) * smoothstep(0.42, 0.85, t);
      h *= k * Math.max(0.12, er ** 0.5);
      rings.push({ c: V(medial(z), top + h * 0.5, z), ax: V(1, 0, 0), az: V(0, 1, 0), rx: w, rzF: h * 0.5, rzB: h * 0.5, pw: 2.6 });
    }
    // flatten the bottom of the upper (rzB half-height but the shape is centred; fine)
    const upper = tubePart(rings, 32, {
      v0: 0.45,
      v1: 1.0,
      disp: (th, j, r) => {
        // laces / tongue ridge along the top centre
        const s = Math.sin(th);
        const t = j / nz;
        return 0.0028 * k * smoothstep(0.92, 1, s) * smoothstep(0.28, 0.36, t) * (1 - smoothstep(0.66, 0.74, t));
      },
    });
    upper.setWeights(W1('footL'));
    parts.push(upper);
  }
  // ---- collar padding ring
  {
    const pts = [];
    const cy = top + spec.collar * k * 0.92;
    for (let i = 0; i <= 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      pts.push(V(Math.sin(a) * 0.038 * k * sk, cy + 0.012 * k * Math.max(0, -Math.cos(a)) - 0.004 * k * Math.max(0, Math.cos(a)), heel + 0.065 * k + Math.cos(a) * 0.052 * k));
    }
    if (!spec.high) {
      const ring = pathTubePart(pts, () => 0.009 * k, 8, { weights: W1('footL') });
      for (let i = 0; i < ring.uv.length; i += 2) {
        ring.uv[i] = 0.75 + (i % 8) * 0.01;
        ring.uv[i + 1] = 0.08;
      }
      parts.push(ring);
    }
  }
  // ---- hightop shaft
  if (spec.high) {
    const rings = [];
    const n = 10;
    for (let j = 0; j <= n; j++) {
      const t = j / n;
      const y = top + 0.02 * k + t * 0.115 * k;
      const r = (0.052 - 0.006 * t + 0.004 * Math.sin(t * Math.PI)) * k * sk;
      const w = blendW(W1('footL'), W1('shinL'), smoothstep(0.35, 1, t) * 0.9);
      rings.push({ c: V(0, y, -0.008 * k + 0.012 * k * t), ax: V(1, 0, 0), az: V(0, 0, 1), rx: r * 0.92, rzF: r * 1.05, rzB: r * 0.98, w });
    }
    const last = rings[rings.length - 1];
    rings.push({ ...last, c: last.c.clone().add(V(0, 0.006 * k, 0)), rx: last.rx * 0.85, rzF: last.rzF * 0.82, rzB: last.rzB * 0.85 });
    const shaft = tubePart(rings, 24, { u0: 0.5, u1: 1, v0: 0.0, v1: 0.16 });
    parts.push(shaft);
  }
  // ---- sock (shorts)
  if (socks) {
    const rings = legRings(rig, 0.27 * k, rig.bindPos.footL.y - 0.02 * k, (y) => {
      const r = legRadius(d, y);
      const a = 0.003 * k;
      return { rx: r.rx + a, rzF: r.rzF + a, rzB: r.rzB + a };
    }, 14);
    const sock = tubePart(rings, 18, { u0: 0, u1: 0.5, v0: 0, v1: 0.16 });
    // sock rings came from legRings (left leg, bind space) -> keep
    parts.push(sock);
  }
  // all parts above are for the LEFT foot, in foot-local space except sock (bind space). Transform foot-local ones.
  const footM = rig.bindWorld.footL;
  const left = new Part();
  for (const p of parts) {
    if (p.si.length && p.si[0] === BI.shinL && false) continue;
    left.append(p);
  }
  // transform: everything except the sock is in foot-local coordinates
  const local = new Part();
  const sockPart = socks ? parts[parts.length - 1] : null;
  for (const p of parts) if (p !== sockPart) local.append(p);
  local.transform(footM);
  const allLeft = new Part();
  allLeft.append(local);
  if (sockPart) allLeft.append(sockPart);
  const geo = buildGeometry([allLeft, allLeft.mirrored()], true);

  // ---- texture
  const cv = makeCanvas(1024, 1024);
  const ctx = cv.getContext('2d');
  const up = app.shoeColor;
  const so = app.shoeSoleColor;
  const RU = region(cv, 0, 1, 0.45, 1, 0.3 * k, L);
  const RSo = region(cv, 0, 1, 0.2, 0.43, 0.3 * k, L);
  const RH = region(cv, 0.5, 1, 0, 0.16, 0.33 * k, 0.12 * k);
  const RK = region(cv, 0, 0.5, 0, 0.16, 0.33 * k, 0.25 * k);
  const RP = region(cv, 0.5, 1, 0.16, 0.2, 0.1, 0.02);
  const isVulc = app.shoes === 'vulc';
  paintFabric(ctx, null, RU, up, isVulc ? 'canvas' : 'suede', 41);
  paintFabric(ctx, null, RSo, so, 'rubber', 42);
  paintFabric(ctx, null, RH, up, 'suede', 43);
  paintFabric(ctx, null, RK, '#f1f0ec', 'knit', 44);
  paintFabric(ctx, null, RP, shade(up, -0.1), 'suede', 45);
  const accent = luminance(up) > 0.5 ? shade(up, -0.55) : mixHex(up, '#ffffff', 0.85);
  const thread = luminance(up) > 0.5 ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.35)';
  // upper: u in [0,1] around (0.5 = top centre, 0.25 = +X side), v along z (0 heel .. L toe)
  RU.begin(ctx);
  const mw = RU.mw;
  const Lz = RU.mh;
  // toe cap
  if (isVulc) {
    ctx.fillStyle = so;
    ctx.fillRect(0, Lz * 0.86, mw, Lz * 0.14);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    for (let x = 0; x < mw; x += 0.004) ctx.fillRect(x, Lz * 0.9, 0.0015, Lz * 0.08);
  } else {
    seamLine(ctx, [[mw * 0.18, Lz * 0.72], [mw * 0.3, Lz * 0.8], [mw * 0.5, Lz * 0.82], [mw * 0.7, Lz * 0.8], [mw * 0.82, Lz * 0.72]], 0.3);
    stitch(ctx, [[mw * 0.18, Lz * 0.735], [mw * 0.3, Lz * 0.815], [mw * 0.5, Lz * 0.835], [mw * 0.7, Lz * 0.815], [mw * 0.82, Lz * 0.735]], thread);
  }
  // side panels: original swoosh-free "wave" stripe on both sides
  for (const sx of [0.25, 0.75]) {
    ctx.save();
    ctx.translate(mw * sx, Lz * 0.45);
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(-0.012, -Lz * 0.32);
    ctx.bezierCurveTo(0.02, -Lz * 0.1, -0.02, Lz * 0.05, 0.008, Lz * 0.25);
    ctx.lineTo(0.016, Lz * 0.25);
    ctx.bezierCurveTo(-0.008, Lz * 0.05, 0.03, -Lz * 0.1, 0.0, -Lz * 0.32);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // panel seams
    seamLine(ctx, [[mw * sx - 0.03, Lz * 0.12], [mw * sx + 0.03, Lz * 0.3]], 0.2);
  }
  // heel tab
  ctx.fillStyle = shade(up, -0.25);
  ctx.fillRect(0, 0, mw * 0.06, Lz * 0.2);
  ctx.fillRect(mw * 0.94, 0, mw * 0.06, Lz * 0.2);
  // lace area: tongue + eyelets + laces (top centre u=0.5, from ~0.3L to 0.7L)
  const lz0 = Lz * 0.3;
  const lz1 = Lz * 0.7;
  ctx.fillStyle = shade(up, -0.12);
  ctx.fillRect(mw * 0.5 - 0.012, lz0 - 0.02, 0.024, lz1 - lz0 + 0.02);
  const laceCol = luminance(up) > 0.6 ? '#e8e6df' : luminance(so) > 0.5 ? '#f2f0ea' : '#d8d5cc';
  ctx.strokeStyle = laceCol;
  ctx.lineWidth = 0.0045;
  ctx.lineCap = 'round';
  const nE = 6;
  for (let i = 0; i < nE; i++) {
    const z = lz0 + ((lz1 - lz0) * i) / (nE - 1);
    for (const sx of [-1, 1]) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      ctx.arc(mw * 0.5 + sx * 0.017, z, 0.0025, 0, Math.PI * 2);
      ctx.fill();
    }
    if (i < nE - 1) {
      const z2 = lz0 + ((lz1 - lz0) * (i + 1)) / (nE - 1);
      ctx.beginPath();
      ctx.moveTo(mw * 0.5 - 0.017, z);
      ctx.lineTo(mw * 0.5 + 0.017, z2);
      ctx.moveTo(mw * 0.5 + 0.017, z);
      ctx.lineTo(mw * 0.5 - 0.017, z2);
      ctx.stroke();
    }
  }
  // eyestay stitching
  stitch(ctx, [[mw * 0.5 - 0.026, lz0 - 0.01], [mw * 0.5 - 0.026, lz1 + 0.01]], thread);
  stitch(ctx, [[mw * 0.5 + 0.026, lz0 - 0.01], [mw * 0.5 + 0.026, lz1 + 0.01]], thread);
  // mudguard stitch along the bottom edge (u near 0/1 is the bottom of the upper)
  stitch(ctx, [[mw * 0.12, 0], [mw * 0.12, Lz]], thread);
  stitch(ctx, [[mw * 0.88, 0], [mw * 0.88, Lz]], thread);
  RU.end(ctx);
  // sole sidewall: u 0.5 top (hidden), 0.25/0.75 sides, 0/1 bottom (tread)
  RSo.begin(ctx);
  {
    const sw = RSo.mw;
    const sl = RSo.mh;
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(sw * 0.36, 0, sw * 0.28, sl);
    if (isVulc) {
      // foxing stripe
      for (const sx of [0.25, 0.75]) {
        ctx.fillStyle = shade(up, -0.1);
        ctx.fillRect(sw * sx - 0.003 + (sx < 0.5 ? 0.006 : -0.006), 0, 0.0035, sl);
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        ctx.fillRect(sw * sx - 0.01, 0, 0.002, sl);
      }
    } else {
      for (const sx of [0.3, 0.7]) stitch(ctx, [[sw * sx, 0], [sw * sx, sl]], 'rgba(0,0,0,0.35)', 0.0015, 0.004);
    }
    // tread on the bottom
    ctx.fillStyle = shade(so, -0.35);
    ctx.fillRect(0, 0, sw * 0.14, sl);
    ctx.fillRect(sw * 0.86, 0, sw * 0.14, sl);
    ctx.strokeStyle = shade(so, -0.6);
    ctx.lineWidth = 0.0025;
    for (let z = 0; z < sl; z += 0.008) {
      ctx.beginPath();
      ctx.moveTo(0, z);
      ctx.lineTo(sw * 0.07, z + 0.004);
      ctx.lineTo(sw * 0.14, z);
      ctx.moveTo(sw * 0.86, z);
      ctx.lineTo(sw * 0.93, z + 0.004);
      ctx.lineTo(sw, z);
      ctx.stroke();
    }
  }
  RSo.end(ctx);
  // hightop shaft details
  RH.begin(ctx);
  stitch(ctx, [[0, RH.mh * 0.85], [RH.mw, RH.mh * 0.85]], thread);
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(RH.mw * 0.25, RH.mh * 0.5, 0.015, 0, Math.PI * 2);
  ctx.arc(RH.mw * 0.75, RH.mh * 0.5, 0.015, 0, Math.PI * 2);
  ctx.fill();
  RH.end(ctx);
  // sock: top rib + a stripe
  RK.begin(ctx);
  ctx.fillStyle = 'rgba(0,0,0,0.06)';
  ctx.fillRect(0, 0, RK.mw, 0.035);
  ctx.fillStyle = app.topGraphicColor || '#c0392b';
  ctx.fillRect(0, 0.045, RK.mw, 0.006);
  ctx.fillRect(0, 0.056, RK.mw, 0.006);
  RK.end(ctx);
  const tex = toTexture(cv);
  const mat = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.78, sheen: 0.4, sheenRoughness: 0.7, sheenColor: new THREE.Color(up).multiplyScalar(0.4) });
  track(store, geo, mat, tex);
  return { geo, mat };
}
