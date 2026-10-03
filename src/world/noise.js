// Small deterministic noise toolkit used for procedural textures and geometry jitter.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

// Tileable value-noise lattice with integer period (wraps seamlessly).
export class TileNoise {
  constructor(period, seed = 1) {
    this.p = Math.max(1, period | 0);
    const r = mulberry32(seed);
    this.v = new Float32Array(this.p * this.p);
    for (let i = 0; i < this.v.length; i++) this.v[i] = r();
  }
  // x, y measured in lattice cells
  sample(x, y) {
    const p = this.p;
    let xi = Math.floor(x);
    let yi = Math.floor(y);
    const fx = fade(x - xi);
    const fy = fade(y - yi);
    xi = ((xi % p) + p) % p;
    yi = ((yi % p) + p) % p;
    const x1 = (xi + 1) % p;
    const y1 = (yi + 1) % p;
    const v = this.v;
    const a = v[yi * p + xi];
    const b = v[yi * p + x1];
    const c = v[y1 * p + xi];
    const d = v[y1 * p + x1];
    const ab = a + (b - a) * fx;
    const cd = c + (d - c) * fx;
    return ab + (cd - ab) * fy;
  }
}

// Simpler isotropic fbm (period equal on both axes) — fast path.
export function fbm(size, basePeriod, octaves, seed, gain = 0.5) {
  const out = new Float32Array(size * size);
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const P = Math.round(basePeriod * 2 ** o);
    const n = new TileNoise(P, seed * 131 + o * 17);
    const s = P / size;
    for (let y = 0; y < size; y++) {
      const yy = y * s;
      for (let x = 0; x < size; x++) out[y * size + x] += amp * n.sample(x * s, yy);
    }
    norm += amp;
    amp *= gain;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

// Anisotropic fbm: different lattice periods along x and y (both must divide nicely).
export function fbmAniso(size, periodX, periodY, octaves, seed, gain = 0.5) {
  const out = new Float32Array(size * size);
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const PX = Math.max(1, Math.round(periodX * 2 ** o));
    const PY = Math.max(1, Math.round(periodY * 2 ** o));
    // build a rectangular lattice
    const r = mulberry32(seed * 977 + o * 31);
    const lat = new Float32Array(PX * PY);
    for (let i = 0; i < lat.length; i++) lat[i] = r();
    const sx = PX / size;
    const sy = PY / size;
    for (let y = 0; y < size; y++) {
      const fyRaw = y * sy;
      const yi = Math.floor(fyRaw);
      const fy = fade(fyRaw - yi);
      const y0 = yi % PY;
      const y1 = (yi + 1) % PY;
      for (let x = 0; x < size; x++) {
        const fxRaw = x * sx;
        const xi = Math.floor(fxRaw);
        const fx = fade(fxRaw - xi);
        const x0 = xi % PX;
        const x1 = (xi + 1) % PX;
        const a = lat[y0 * PX + x0];
        const b = lat[y0 * PX + x1];
        const c = lat[y1 * PX + x0];
        const d = lat[y1 * PX + x1];
        const ab = a + (b - a) * fx;
        const cd = c + (d - c) * fx;
        out[y * size + x] += amp * (ab + (cd - ab) * fy);
      }
    }
    norm += amp;
    amp *= gain;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

// Smooth 2D value noise for geometry (non-tiling), deterministic.
export function makeNoise2D(seed = 7) {
  const r = mulberry32(seed);
  const perm = new Uint8Array(512);
  const vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    perm[i] = i;
    vals[i] = r();
  }
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = perm[i];
    perm[i] = perm[j];
    perm[j] = t;
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const h = (x, y) => vals[perm[(perm[x & 255] + y) & 511] & 255];
  const n = (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = fade(x - xi);
    const fy = fade(y - yi);
    const a = h(xi, yi);
    const b = h(xi + 1, yi);
    const c = h(xi, yi + 1);
    const d = h(xi + 1, yi + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  n.fbm = (x, y, oct = 4) => {
    let s = 0;
    let a = 1;
    let t = 0;
    for (let i = 0; i < oct; i++) {
      s += a * n(x, y);
      t += a;
      a *= 0.5;
      x *= 2.03;
      y *= 2.03;
    }
    return s / t;
  };
  return n;
}
