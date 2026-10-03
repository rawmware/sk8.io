// Procedural PBR texture generation (no external assets).
// Every map is tileable. UVs throughout the world are in meters; each texture's `repeat`
// converts meters into texture tiles (see `meters` per entry).
import * as THREE from 'three';
import { fbm, fbmAniso, mulberry32 } from './noise.js';

let ANISO = 8;

function finishTex(tex, { srgb = false, meters = 1, metersY } = {}) {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = ANISO;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.repeat.set(1 / meters, 1 / (metersY ?? meters));
  tex.needsUpdate = true;
  return tex;
}

function dataTex(data, size, opts) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  return finishTex(t, opts);
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const to8 = (v) => (v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0);

function rgbaFrom(size, fn) {
  const d = new Uint8Array(size * size * 4);
  const c = [0, 0, 0, 1];
  for (let y = 0, i = 0; y < size; y++) {
    for (let x = 0; x < size; x++, i++) {
      fn(x, y, i, c);
      const o = i * 4;
      d[o] = to8(c[0]);
      d[o + 1] = to8(c[1]);
      d[o + 2] = to8(c[2]);
      d[o + 3] = to8(c[3]);
    }
  }
  return d;
}

// Tangent-space normal map from height field (wrapping). strength ~ height units per pixel.
function normalFromHeight(h, size, strength) {
  const d = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const ym = ((y - 1 + size) % size) * size;
    const yp = ((y + 1) % size) * size;
    const yr = y * size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size;
      const xp = (x + 1) % size;
      const dx = (h[yr + xp] - h[yr + xm]) * strength;
      const dy = (h[yp + x] - h[ym + x]) * strength;
      let nx = -dx;
      let ny = -dy;
      let nz = 1;
      const l = 1 / Math.hypot(nx, ny, nz);
      nx *= l;
      ny *= l;
      nz *= l;
      const o = (yr + x) * 4;
      d[o] = to8(nx * 0.5 + 0.5);
      d[o + 1] = to8(ny * 0.5 + 0.5);
      d[o + 2] = to8(nz * 0.5 + 0.5);
      d[o + 3] = 255;
    }
  }
  return d;
}

// Soft brush stamping into a float field with wrap-around. mode: 'add' | 'min' | 'max' | 'set'
function stamp(field, size, cx, cy, r, value, mode = 'add', soft = true) {
  const ri = Math.ceil(r + 1);
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  for (let j = -ri; j <= ri; j++) {
    for (let i = -ri; i <= ri; i++) {
      const dx = x0 + i - cx;
      const dy = y0 + j - cy;
      const dd = Math.sqrt(dx * dx + dy * dy);
      if (dd > r + 0.5) continue;
      let w = soft ? clamp01(1 - dd / (r + 0.5)) : clamp01(r + 0.5 - dd);
      if (soft) w = w * w * (3 - 2 * w);
      const px = (((x0 + i) % size) + size) % size;
      const py = (((y0 + j) % size) + size) % size;
      const k = py * size + px;
      const v = value * w;
      if (mode === 'add') field[k] += v;
      else if (mode === 'min') field[k] = Math.min(field[k], field[k] * (1 - w) + value * w);
      else if (mode === 'max') field[k] = Math.max(field[k], v);
      else field[k] = field[k] * (1 - w) + value * w;
    }
  }
}

function strokePath(field, size, pts, r, value, mode) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const len = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(len / Math.max(0.5, r * 0.5)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      stamp(field, size, ax + (bx - ax) * t, ay + (by - ay) * t, typeof r === 'function' ? r(t) : r, value, mode);
    }
  }
}

function randomWalk(rand, x, y, n, step, turn) {
  const pts = [[x, y]];
  let a = rand() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    a += (rand() - 0.5) * turn;
    x += Math.cos(a) * step;
    y += Math.sin(a) * step;
    pts.push([x, y]);
  }
  return pts;
}

// ------------------------------------------------------------------------------------------
// Concrete (park ground): fine aggregate, stains, skid marks, saw-cut joints every 3m.
// Texture covers 6m x 6m.
function makeConcrete(size = 1024) {
  const fine = fbm(size, 128, 3, 11, 0.6);
  const mid = fbm(size, 16, 4, 12, 0.5);
  const stain = fbm(size, 5, 5, 13, 0.55);
  const rand = mulberry32(99);
  const pits = new Float32Array(size * size);
  const speck = new Float32Array(size * size);
  const skid = new Float32Array(size * size);
  const crack = new Float32Array(size * size);
  const joint = new Float32Array(size * size);
  const npits = (size * size) / 700;
  for (let i = 0; i < npits; i++) stamp(pits, size, rand() * size, rand() * size, 0.5 + rand() * rand() * 1.4, 0.4 + rand() * 0.6, 'max');
  for (let i = 0; i < npits * 6; i++) {
    const k = ((rand() * size) | 0) + ((rand() * size) | 0) * size;
    speck[k] = rand() * 2 - 0.7;
  }
  // skid / wheel marks: long gentle arcs, dark rubber
  for (let i = 0; i < 34; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const a = rand() * Math.PI * 2;
    const len = 40 + rand() * 260;
    const curv = (rand() - 0.5) * 0.012;
    const pts = [];
    let ang = a;
    let px = x;
    let py = y;
    for (let s = 0; s < len; s += 4) {
      pts.push([px, py]);
      ang += curv * 4;
      px += Math.cos(ang) * 4;
      py += Math.sin(ang) * 4;
    }
    const w = 1.2 + rand() * 3.5;
    const strength = 0.15 + rand() * 0.35;
    strokePath(skid, size, pts, w, strength, 'max');
    if (rand() < 0.5) {
      // double wheel track
      const ox = Math.cos(a + Math.PI / 2) * 16;
      const oy = Math.sin(a + Math.PI / 2) * 16;
      strokePath(skid, size, pts.map(([u, v]) => [u + ox, v + oy]), w, strength * 0.8, 'max');
    }
  }
  // hairline cracks
  for (let i = 0; i < 3; i++) {
    const pts = randomWalk(rand, rand() * size, rand() * size, 20 + rand() * 40, 3, 0.7);
    strokePath(crack, size, pts, 0.6, 0.6, 'max');
  }
  // saw-cut joints at 0 and size/2 (=3m spacing)
  const jw = 1.1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.min(x % (size / 2), size / 2 - (x % (size / 2)));
      const dy = Math.min(y % (size / 2), size / 2 - (y % (size / 2)));
      const d = Math.min(dx, dy);
      let j = 0;
      if (d < jw) j = 1;
      else if (d < jw + 1.5) j = 0.45;
      const dirt = d < 14 ? (1 - d / 14) * 0.35 : 0;
      joint[y * size + x] = Math.max(j, dirt * 0.4);
      if (d < jw) joint[y * size + x] = 1;
    }
  }
  const height = new Float32Array(size * size);
  const map = rgbaFrom(size, (x, y, i, c) => {
    const f = fine[i];
    const m = mid[i];
    const s = stain[i];
    let v = 0.5 + (m - 0.5) * 0.1 + (f - 0.5) * 0.12 + speck[i] * 0.04;
    v *= 1 - clamp01((0.58 - s) * 1.6) * 0.22; // dark blotches
    v *= 1 + clamp01((s - 0.62) * 2.5) * 0.08; // pale worn patches
    v *= 1 - pits[i] * 0.18;
    v *= 1 - skid[i] * 0.55;
    v *= 1 - crack[i] * 0.3;
    const j = joint[i];
    v *= 1 - (j >= 1 ? 0.42 : j * 0.25);
    const warm = (s - 0.5) * 0.05;
    c[0] = v * (1.05 + warm);
    c[1] = v * 1.0;
    c[2] = v * (0.9 - warm);
    c[3] = 1;
    height[i] = f * 0.5 + m * 0.35 - pits[i] * 0.5 - crack[i] * 0.6 - (j >= 1 ? 1.4 : j * 0.3) + speck[i] * 0.08;
  });
  const rough = rgbaFrom(size, (x, y, i, c) => {
    const r = 0.86 + (fine[i] - 0.5) * 0.12 - clamp01((stain[i] - 0.55) * 2) * 0.12 - skid[i] * 0.2 + pits[i] * 0.06;
    c[0] = 1;
    c[1] = clamp01(r);
    c[2] = 0;
    c[3] = 1;
  });
  const normal = normalFromHeight(height, size, 2.2);
  return {
    map: dataTex(map, size, { srgb: true, meters: 6 }),
    normalMap: dataTex(normal, size, { meters: 6 }),
    roughnessMap: dataTex(rough, size, { meters: 6 }),
  };
}

// Smooth / polished concrete for transitions. Covers 4m.
function makeSmoothConcrete(size = 512) {
  const fine = fbm(size, 96, 3, 21, 0.55);
  const trowel = fbmAniso(size, 3, 24, 4, 22, 0.55);
  const stain = fbm(size, 4, 5, 23, 0.55);
  const rand = mulberry32(5);
  const pits = new Float32Array(size * size);
  const skid = new Float32Array(size * size);
  for (let i = 0; i < size * size / 500; i++) stamp(pits, size, rand() * size, rand() * size, 0.5 + rand(), 1, 'max');
  for (let i = 0; i < 14; i++) {
    const pts = randomWalk(rand, rand() * size, rand() * size, 30, 4, 0.12);
    strokePath(skid, size, pts, 1 + rand() * 2, 0.2 + rand() * 0.3, 'max');
  }
  const height = new Float32Array(size * size);
  const map = rgbaFrom(size, (x, y, i, c) => {
    let v = 0.66 + (fine[i] - 0.5) * 0.07 + (trowel[i] - 0.5) * 0.06 + (stain[i] - 0.5) * 0.12;
    v *= 1 - pits[i] * 0.2;
    v *= 1 - skid[i] * 0.5;
    c[0] = v * 1.0;
    c[1] = v * 0.99;
    c[2] = v * 0.965;
    c[3] = 1;
    height[i] = fine[i] * 0.3 + trowel[i] * 0.4 - pits[i] * 0.6;
  });
  const rough = rgbaFrom(size, (x, y, i, c) => {
    c[0] = 1;
    c[1] = clamp01(0.62 + (trowel[i] - 0.5) * 0.18 + (stain[i] - 0.5) * 0.15 - skid[i] * 0.15);
    c[2] = 0;
    c[3] = 1;
  });
  return {
    map: dataTex(map, size, { srgb: true, meters: 4 }),
    normalMap: dataTex(normalFromHeight(height, size, 1.2), size, { meters: 4 }),
    roughnessMap: dataTex(rough, size, { meters: 4 }),
  };
}

// Asphalt. Covers 2m.
function makeAsphalt(size = 512) {
  const fine = fbm(size, 128, 2, 31, 0.6);
  const mid = fbm(size, 8, 5, 32, 0.55);
  const rand = mulberry32(33);
  const stones = new Float32Array(size * size);
  const stoneCol = new Float32Array(size * size);
  for (let i = 0; i < size * size / 14; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 0.5 + rand() * rand() * 2.2;
    stamp(stones, size, x, y, r, 1, 'max', false);
    stamp(stoneCol, size, x, y, r, 0.2 + rand() * 0.8, 'set', false);
  }
  const height = new Float32Array(size * size);
  const map = rgbaFrom(size, (x, y, i, c) => {
    let v = 0.16 + (fine[i] - 0.5) * 0.05 + (mid[i] - 0.5) * 0.08;
    v = v * (1 - stones[i]) + stones[i] * (0.17 + stoneCol[i] * 0.22);
    const t = (mid[i] - 0.5) * 0.04;
    c[0] = v + t;
    c[1] = v + t * 0.6;
    c[2] = v * 1.02;
    c[3] = 1;
    height[i] = stones[i] * 0.7 + fine[i] * 0.3 + mid[i] * 0.2;
  });
  const rough = rgbaFrom(size, (x, y, i, c) => {
    c[0] = 1;
    c[1] = clamp01(0.9 - stones[i] * 0.12 + (mid[i] - 0.5) * 0.1);
    c[2] = 0;
    c[3] = 1;
  });
  return {
    map: dataTex(map, size, { srgb: true, meters: 2 }),
    normalMap: dataTex(normalFromHeight(height, size, 2.0), size, { meters: 2 }),
    roughnessMap: dataTex(rough, size, { meters: 2 }),
  };
}

// Skatelite-style composite ramp surface: sheets 1.22 x 2.44, screw rows, wheel wear. Covers 2.44m.
function makeSkatelite(size = 512) {
  const mott = fbm(size, 6, 5, 41, 0.55);
  const fine = fbm(size, 128, 2, 42, 0.5);
  const wear = fbmAniso(size, 2, 16, 4, 43, 0.55);
  const seam = new Float32Array(size * size);
  const screws = new Float32Array(size * size);
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.min(x, size - x);
      const dy = Math.min(y % half, half - (y % half));
      seam[y * size + x] = dx < 1.2 || dy < 1.2 ? 1 : 0;
    }
  }
  const inset = 8; // ~4cm
  const pitch = 62; // ~30cm
  for (let s = pitch / 2; s < size; s += pitch) {
    for (const off of [inset, size - inset]) {
      stamp(screws, size, off, s, 1.3, 1, 'max');
    }
    for (const yy of [inset, half - inset, half + inset, size - inset]) stamp(screws, size, s, yy, 1.3, 1, 'max');
  }
  const height = new Float32Array(size * size);
  const map = rgbaFrom(size, (x, y, i, c) => {
    let v = 0.3 + (mott[i] - 0.5) * 0.07 + (fine[i] - 0.5) * 0.025;
    v += clamp01((wear[i] - 0.5) * 2.5) * 0.06;
    v *= 1 - seam[i] * 0.45;
    const sc = screws[i];
    c[0] = (v * 1.16) * (1 - sc) + sc * 0.42;
    c[1] = (v * 0.98) * (1 - sc) + sc * 0.42;
    c[2] = (v * 0.86) * (1 - sc) + sc * 0.4;
    c[3] = 1;
    height[i] = fine[i] * 0.15 + mott[i] * 0.1 - seam[i] * 0.8 - sc * 0.4;
  });
  const rough = rgbaFrom(size, (x, y, i, c) => {
    c[0] = 1;
    c[1] = clamp01(0.5 - clamp01((wear[i] - 0.5) * 2) * 0.12 + (mott[i] - 0.5) * 0.1 + seam[i] * 0.3 - screws[i] * 0.2);
    c[2] = screws[i];
    c[3] = 1;
  });
  return {
    map: dataTex(map, size, { srgb: true, meters: 2.44 }),
    normalMap: dataTex(normalFromHeight(height, size, 1.5), size, { meters: 2.44 }),
    roughnessMap: dataTex(rough, size, { meters: 2.44 }),
  };
}

// Plywood grain. Covers 1.22m.
function makePlywood(size = 512) {
  const grain = fbmAniso(size, 2, 48, 5, 51, 0.6);
  const knots = fbm(size, 6, 3, 52, 0.5);
  const map = rgbaFrom(size, (x, y, i, c) => {
    const g = grain[i];
    const rings = 0.5 + 0.5 * Math.sin(g * 60 + knots[i] * 8);
    let v = 0.62 + (g - 0.5) * 0.25 - rings * 0.07;
    c[0] = v * 1.0;
    c[1] = v * 0.78;
    c[2] = v * 0.52;
    c[3] = 1;
  });
  return { map: dataTex(map, size, { srgb: true, meters: 1.22 }) };
}

// Generic metal roughness/normal detail (scratches + blotches). Covers 1m.
function makeMetalDetail(size = 256) {
  const blot = fbm(size, 8, 4, 61, 0.55);
  const fine = fbm(size, 64, 2, 62, 0.5);
  const rand = mulberry32(63);
  const scr = new Float32Array(size * size);
  for (let i = 0; i < 70; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const a = (rand() - 0.5) * 0.6;
    const l = 10 + rand() * 60;
    strokePath(scr, size, [[x, y], [x + Math.cos(a) * l, y + Math.sin(a) * l]], 0.5, 0.5 + rand() * 0.5, 'max');
  }
  const height = new Float32Array(size * size);
  const rough = rgbaFrom(size, (x, y, i, c) => {
    c[0] = 1;
    c[1] = clamp01(0.42 + (blot[i] - 0.5) * 0.3 + (fine[i] - 0.5) * 0.08 - scr[i] * 0.2);
    c[2] = 1;
    c[3] = 1;
    height[i] = fine[i] * 0.2 - scr[i] * 0.5;
  });
  // galvanized spangle (voronoi-ish)
  const pts = [];
  for (let i = 0; i < 90; i++) pts.push([rand() * size, rand() * size, 0.75 + rand() * 0.25]);
  const galv = rgbaFrom(size, (x, y, i, c) => {
    let best = 1e9;
    let val = 1;
    for (const [px, py, v] of pts) {
      let dx = Math.abs(px - x);
      let dy = Math.abs(py - y);
      if (dx > size / 2) dx = size - dx;
      if (dy > size / 2) dy = size - dy;
      const d = dx * dx + dy * dy;
      if (d < best) {
        best = d;
        val = v;
      }
    }
    const g = val * (0.92 + (blot[i] - 0.5) * 0.15);
    c[0] = g;
    c[1] = g;
    c[2] = g * 1.02;
    c[3] = 1;
  });
  return {
    roughnessMap: dataTex(rough, size, { meters: 1 }),
    normalMap: dataTex(normalFromHeight(height, size, 1.0), size, { meters: 1 }),
    galvMap: dataTex(galv, size, { srgb: true, meters: 0.6 }),
  };
}

// Bricks. Covers 0.9m (x) by 0.6m (y): 4 bricks per row, 8 rows.
function makeBrick(size = 512) {
  const rand = mulberry32(71);
  const fine = fbm(size, 64, 3, 72, 0.55);
  const blot = fbm(size, 8, 4, 73, 0.5);
  const rows = 8;
  const perRow = 4;
  const rowH = size / rows;
  const bw = size / perRow;
  const mortX = 5;
  const mortY = 7;
  const tint = [];
  for (let i = 0; i < rows * perRow * 2; i++) {
    const r = rand();
    tint.push([0.5 + r * 0.18 + rand() * 0.06, 0.2 + rand() * 0.08 + r * 0.05, 0.14 + rand() * 0.06, rand()]);
  }
  const height = new Float32Array(size * size);
  const map = rgbaFrom(size, (x, y, i, c) => {
    const row = Math.floor(y / rowH);
    const yy = y - row * rowH;
    const off = row % 2 ? bw / 2 : 0;
    const xs = (x + off) % size;
    const col = Math.floor(xs / bw);
    const xx = xs - col * bw;
    const ex = Math.min(xx, bw - xx);
    const ey = Math.min(yy, rowH - yy);
    const inMortar = ex < mortX / 2 || ey < mortY / 2;
    const t = tint[row * perRow + col];
    if (inMortar) {
      const m = 0.55 + (fine[i] - 0.5) * 0.15;
      c[0] = m;
      c[1] = m * 0.97;
      c[2] = m * 0.92;
      height[i] = 0.1 + fine[i] * 0.1;
    } else {
      const edge = clamp01(Math.min(ex - mortX / 2, ey - mortY / 2) / 3);
      const n = (fine[i] - 0.5) * 0.12 + (blot[i] - 0.5) * 0.1;
      const burnt = t[3] > 0.85 ? 0.6 : 1;
      c[0] = (t[0] + n) * burnt;
      c[1] = (t[1] + n * 0.6) * burnt;
      c[2] = (t[2] + n * 0.5) * burnt;
      height[i] = 0.6 + edge * 0.35 + fine[i] * 0.15;
    }
    c[3] = 1;
  });
  return {
    map: dataTex(map, size, { srgb: true, meters: 0.9, metersY: 0.6 }),
    normalMap: dataTex(normalFromHeight(height, size, 3.0), size, { meters: 0.9, metersY: 0.6 }),
  };
}

// Grass. Covers 3m.
function makeGrass(size = 512) {
  const big = fbm(size, 4, 5, 81, 0.55);
  const mid = fbm(size, 24, 3, 82, 0.55);
  const blades = fbmAniso(size, 256, 64, 2, 83, 0.5);
  const height = new Float32Array(size * size);
  const map = rgbaFrom(size, (x, y, i, c) => {
    const dry = clamp01((big[i] - 0.45) * 2.2);
    const b = blades[i];
    const v = 0.55 + (mid[i] - 0.5) * 0.5 + (b - 0.5) * 0.7;
    c[0] = (0.12 + dry * 0.17) * v * 1.2;
    c[1] = (0.24 + dry * 0.08) * v * 1.2;
    c[2] = (0.06 + dry * 0.03) * v;
    c[3] = 1;
    height[i] = b * 0.7 + mid[i] * 0.3;
  });
  return {
    map: dataTex(map, size, { srgb: true, meters: 3 }),
    normalMap: dataTex(normalFromHeight(height, size, 2.5), size, { meters: 3 }),
  };
}

// Pool tiles 15cm, 4x4 per tile repeat (0.6m)
function makeTile(size = 256) {
  const rand = mulberry32(91);
  const fine = fbm(size, 32, 2, 92, 0.5);
  const n = 4;
  const t = size / n;
  const cols = [];
  for (let i = 0; i < n * n; i++) {
    const k = rand();
    cols.push(k > 0.85 ? [0.05, 0.22, 0.42] : [0.08 + rand() * 0.04, 0.38 + rand() * 0.08, 0.62 + rand() * 0.08]);
  }
  const height = new Float32Array(size * size);
  const map = rgbaFrom(size, (x, y, i, c) => {
    const cx = Math.floor(x / t);
    const cy = Math.floor(y / t);
    const ex = Math.min(x - cx * t, (cx + 1) * t - x);
    const ey = Math.min(y - cy * t, (cy + 1) * t - y);
    const e = Math.min(ex, ey);
    if (e < 1.6) {
      const g = 0.72 + (fine[i] - 0.5) * 0.1;
      c[0] = g;
      c[1] = g;
      c[2] = g * 0.96;
      height[i] = 0;
    } else {
      const col = cols[cy * n + cx];
      const s = 0.92 + (fine[i] - 0.5) * 0.16;
      c[0] = col[0] * s;
      c[1] = col[1] * s;
      c[2] = col[2] * s;
      height[i] = 0.5 + clamp01((e - 1.6) / 3) * 0.5;
    }
    c[3] = 1;
  });
  return {
    map: dataTex(map, size, { srgb: true, meters: 0.6 }),
    normalMap: dataTex(normalFromHeight(height, size, 2.0), size, { meters: 0.6 }),
  };
}

// Chain-link diamond mesh (RGBA with alpha). Covers 0.4m.
function makeChainLink(size = 256) {
  const period = size / 8; // 5cm diamonds
  const w = 1.6;
  const map = rgbaFrom(size, (x, y, i, c) => {
    const a = (x + y) % period;
    const b = (((x - y) % period) + period) % period;
    const da = Math.min(a, period - a);
    const db = Math.min(b, period - b);
    const d = Math.min(da, db);
    const cov = clamp01(w - d + 0.5);
    const shade = 0.75 + 0.2 * (da < db ? 1 : 0);
    c[0] = shade;
    c[1] = shade;
    c[2] = shade * 1.03;
    c[3] = cov;
  });
  return { map: dataTex(map, size, { srgb: true, meters: 0.4 }) };
}

// Bark. Covers 0.8m x 1.6m
function makeBark(size = 256) {
  const g = fbmAniso(size, 12, 2, 5, 101, 0.55);
  const f = fbm(size, 32, 3, 102, 0.5);
  const height = new Float32Array(size * size);
  const map = rgbaFrom(size, (x, y, i, c) => {
    const ridge = 1 - Math.abs(g[i] - 0.5) * 2;
    const v = 0.25 + ridge * 0.16 + (f[i] - 0.5) * 0.1;
    c[0] = v * 1.05;
    c[1] = v * 0.92;
    c[2] = v * 0.8;
    c[3] = 1;
    height[i] = ridge * 0.8 + f[i] * 0.3;
  });
  return {
    map: dataTex(map, size, { srgb: true, meters: 0.8, metersY: 1.6 }),
    normalMap: dataTex(normalFromHeight(height, size, 3), size, { meters: 0.8, metersY: 1.6 }),
  };
}

// Corrugated sheet metal normal. Covers 0.76m horizontally (10 ribs).
function makeCorrugated(size = 256) {
  const f = fbm(size, 16, 3, 111, 0.5);
  const height = new Float32Array(size * size);
  const map = rgbaFrom(size, (x, y, i, c) => {
    const s = Math.sin((x / size) * Math.PI * 2 * 10);
    height[i] = s * 2.2 + f[i] * 0.2;
    const streak = 0.9 + (f[i] - 0.5) * 0.25;
    c[0] = streak;
    c[1] = streak;
    c[2] = streak;
    c[3] = 1;
  });
  return {
    map: dataTex(map, size, { srgb: true, meters: 0.76, metersY: 2 }),
    normalMap: dataTex(normalFromHeight(height, size, 1.0), size, { meters: 0.76, metersY: 2 }),
  };
}

// Large-scale variation (world-space macro tint / stains)
function makeMacro(size = 256) {
  const f = fbm(size, 4, 6, 121, 0.58);
  const map = rgbaFrom(size, (x, y, i, c) => {
    c[0] = f[i];
    c[1] = f[(i * 7 + 13) % f.length];
    c[2] = 0;
    c[3] = 1;
  });
  return dataTex(map, size, { meters: 1 });
}

// Leaf cards (alpha). Drawn on canvas.
function makeLeaves(size = 512) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const rand = mulberry32(131);
  g.clearRect(0, 0, size, size);
  const cx = size / 2;
  const cy = size / 2;
  for (let i = 0; i < 380; i++) {
    const a = rand() * Math.PI * 2;
    const rr = Math.sqrt(rand()) * size * 0.44;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    const l = size * (0.045 + rand() * 0.035);
    const w = l * (0.42 + rand() * 0.15);
    const shade = 0.45 + rand() * 0.35 - (rr / size) * 0.3;
    const hue = 70 + rand() * 40;
    g.save();
    g.translate(x, y);
    g.rotate(a + (rand() - 0.5) * 1.6);
    g.fillStyle = `hsl(${hue}, ${38 + rand() * 25}%, ${Math.round(18 + shade * 22)}%)`;
    g.beginPath();
    g.moveTo(-l, 0);
    g.quadraticCurveTo(0, -w, l, 0);
    g.quadraticCurveTo(0, w, -l, 0);
    g.fill();
    g.strokeStyle = `rgba(30,40,10,0.35)`;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(-l, 0);
    g.lineTo(l, 0);
    g.stroke();
    g.restore();
  }
  // a few twigs
  g.strokeStyle = 'rgba(60,45,30,0.9)';
  g.lineWidth = 3;
  for (let i = 0; i < 5; i++) {
    g.beginPath();
    g.moveTo(cx, cy);
    const a = rand() * Math.PI * 2;
    g.lineTo(cx + Math.cos(a) * size * 0.35, cy + Math.sin(a) * size * 0.35);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  finishTex(t, { srgb: true, meters: 1 });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.repeat.set(1, 1);
  return t;
}

// ---- Murals: original abstract graffiti pieces with "SK8.IO" lettering ----
function makeMural(seed, w = 1024, h = 512, palette) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d');
  const rand = mulberry32(seed);
  const P = palette;
  // wall base
  g.fillStyle = P.wall;
  g.fillRect(0, 0, w, h);
  // background: big gradient sweep
  const grd = g.createLinearGradient(0, 0, w, h);
  grd.addColorStop(0, P.bg[0]);
  grd.addColorStop(0.5, P.bg[1]);
  grd.addColorStop(1, P.bg[2]);
  g.fillStyle = grd;
  g.beginPath();
  g.moveTo(0, h * 0.12);
  for (let x = 0; x <= w; x += w / 8) g.lineTo(x, h * (0.06 + rand() * 0.12));
  g.lineTo(w, h * 0.92);
  for (let x = w; x >= 0; x -= w / 8) g.lineTo(x, h * (0.86 + rand() * 0.1));
  g.closePath();
  g.fill();
  // abstract blobs, rings and stripes
  for (let i = 0; i < 18; i++) {
    const x = rand() * w;
    const y = h * 0.15 + rand() * h * 0.7;
    const r = 20 + rand() * 120;
    g.globalAlpha = 0.5 + rand() * 0.5;
    g.fillStyle = P.accents[(rand() * P.accents.length) | 0];
    g.beginPath();
    const n = 9;
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * Math.PI * 2;
      const rr = r * (0.7 + rand() * 0.5);
      const px = x + Math.cos(a) * rr;
      const py = y + Math.sin(a) * rr * 0.8;
      if (k === 0) g.moveTo(px, py);
      else g.quadraticCurveTo(x + Math.cos(a - 0.3) * rr * 1.2, y + Math.sin(a - 0.3) * rr, px, py);
    }
    g.fill();
  }
  g.globalAlpha = 1;
  for (let i = 0; i < 6; i++) {
    g.strokeStyle = P.accents[(rand() * P.accents.length) | 0];
    g.lineWidth = 6 + rand() * 18;
    g.beginPath();
    const y0 = h * (0.2 + rand() * 0.6);
    g.moveTo(-20, y0);
    g.bezierCurveTo(w * 0.3, y0 - 120 + rand() * 240, w * 0.6, y0 - 120 + rand() * 240, w + 20, y0 + (rand() - 0.5) * 100);
    g.stroke();
  }
  // star bursts / sparkles
  g.fillStyle = '#ffffff';
  for (let i = 0; i < 14; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const s = 6 + rand() * 16;
    g.beginPath();
    g.moveTo(x, y - s);
    g.lineTo(x + s * 0.25, y - s * 0.25);
    g.lineTo(x + s, y);
    g.lineTo(x + s * 0.25, y + s * 0.25);
    g.lineTo(x, y + s);
    g.lineTo(x - s * 0.25, y + s * 0.25);
    g.lineTo(x - s, y);
    g.lineTo(x - s * 0.25, y - s * 0.25);
    g.fill();
  }
  // lettering
  const text = P.text || 'SK8.IO';
  const fs = h * 0.42;
  g.save();
  g.translate(w / 2, h * 0.55);
  g.rotate(P.tilt || -0.06);
  g.font = `italic 900 ${fs}px "Arial Black", Impact, "Helvetica Neue", Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  // 3D extrusion
  for (let d = 18; d > 0; d -= 2) {
    g.fillStyle = P.shadow;
    g.fillText(text, d, d);
  }
  g.lineWidth = 22;
  g.strokeStyle = P.outline;
  g.strokeText(text, 0, 0);
  const lg = g.createLinearGradient(0, -fs / 2, 0, fs / 2);
  lg.addColorStop(0, P.fill[0]);
  lg.addColorStop(0.55, P.fill[1]);
  lg.addColorStop(1, P.fill[2]);
  g.fillStyle = lg;
  g.fillText(text, 0, 0);
  // highlight streaks
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(255,255,255,0.35)';
  for (let i = 0; i < 4; i++) g.fillRect(-w / 2, -fs * 0.35 + i * 18, w, 5);
  g.restore();
  g.globalCompositeOperation = 'source-over';
  // drips
  for (let i = 0; i < 40; i++) {
    const x = rand() * w;
    const y = h * (0.3 + rand() * 0.5);
    g.fillStyle = P.accents[(rand() * P.accents.length) | 0];
    g.globalAlpha = 0.8;
    const len = 10 + rand() * 60;
    g.fillRect(x, y, 3 + rand() * 3, len);
    g.beginPath();
    g.arc(x + 3, y + len, 3.5, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  // tag scribbles (original, abstract)
  g.strokeStyle = P.outline;
  g.lineWidth = 4;
  for (let k = 0; k < 2; k++) {
    g.beginPath();
    let x = w * (0.08 + rand() * 0.2) + k * w * 0.62;
    let y = h * 0.86;
    g.moveTo(x, y);
    for (let i = 0; i < 14; i++) {
      x += 8 + rand() * 12;
      y = h * 0.86 + (rand() - 0.5) * 34;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  // weathering: speckle + fade
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  const fade = fbm(256, 6, 4, seed + 3, 0.55);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const f = fade[((y & 255) * 256) + (x & 255)];
      const k = 0.82 + f * 0.2 + (rand() - 0.5) * 0.06;
      d[o] *= k;
      d[o + 1] *= k;
      d[o + 2] *= k;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = ANISO;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// Sign / small graphics (park sign)
function makeSign() {
  const w = 512;
  const h = 256;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d');
  g.fillStyle = '#16181c';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#f2c230';
  g.lineWidth = 10;
  g.strokeRect(10, 10, w - 20, h - 20);
  g.fillStyle = '#f4f4f0';
  g.font = 'italic 900 110px "Arial Black", Impact, Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('SK8.IO', w / 2, h * 0.42);
  g.font = 'bold 34px Arial, sans-serif';
  g.fillStyle = '#f2c230';
  g.fillText('MUNICIPAL SKATE PARK', w / 2, h * 0.78);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = ANISO;
  return t;
}

export function createTextures(renderer) {
  ANISO = Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() || 4);
  const t0 = performance.now();
  const tex = {
    concrete: makeConcrete(1024),
    smooth: makeSmoothConcrete(512),
    asphalt: makeAsphalt(512),
    skatelite: makeSkatelite(512),
    plywood: makePlywood(512),
    metal: makeMetalDetail(256),
    brick: makeBrick(512),
    grass: makeGrass(512),
    tile: makeTile(256),
    chain: makeChainLink(256),
    bark: makeBark(256),
    corrugated: makeCorrugated(256),
    macro: makeMacro(256),
    leaves: makeLeaves(512),
    murals: [
      makeMural(7, 1024, 512, {
        wall: '#d8d2c4',
        bg: ['#1b2a6b', '#6a2c8f', '#e0457b'],
        accents: ['#ffd23f', '#3bceac', '#ee4266', '#0ead69', '#f8f8f8'],
        fill: ['#fff35c', '#ffb703', '#fb5607'],
        outline: '#111111',
        shadow: '#2a0a3a',
        tilt: -0.07,
      }),
      makeMural(23, 1024, 512, {
        wall: '#b9b4ab',
        bg: ['#0b3d2e', '#1f7a5a', '#a7e8bd'],
        accents: ['#f72585', '#4cc9f0', '#ffbe0b', '#fefae0', '#3a0ca3'],
        fill: ['#e0fbfc', '#98c1d9', '#3d5a80'],
        outline: '#0a0a0a',
        shadow: '#081c15',
        tilt: 0.05,
      }),
      makeMural(41, 1024, 512, {
        wall: '#cfc6b8',
        bg: ['#ff7b00', '#ff2e63', '#4a1942'],
        accents: ['#08d9d6', '#eaeaea', '#252a34', '#ffd166', '#06d6a0'],
        fill: ['#f8f9fa', '#08d9d6', '#00728a'],
        outline: '#0d0d0d',
        shadow: '#2b0f2a',
        text: 'SKATE',
        tilt: -0.03,
      }),
    ],
    sign: makeSign(),
  };
  tex.buildMs = performance.now() - t0;
  return tex;
}
