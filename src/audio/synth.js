// Low-level WebAudio helpers for SK8.IO's procedural sound design.

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
const EPS = 0.0001;

/** Build the shared noise / texture buffers once per context. */
export function makeBuffers(ctx) {
  const sr = ctx.sampleRate;
  const make = (seconds, fill, channels = 1) => {
    const len = Math.floor(sr * seconds);
    const buf = ctx.createBuffer(channels, len, sr);
    for (let c = 0; c < channels; c++) fill(buf.getChannelData(c), len, c);
    return buf;
  };
  const normalize = (d, peak = 0.9) => {
    let m = 0;
    for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
    if (m > 0) for (let i = 0; i < d.length; i++) d[i] *= peak / m;
  };
  // make loops seamless: the tail cross-fades into the head, and the loop restarts at sample n
  const seam = (buf, n = 2048) => {
    const d = buf.getChannelData(0);
    const L = d.length;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      d[L - n + i] = d[L - n + i] * (1 - t) + d[i] * t;
    }
    buf._loopStart = n / sr;
  };
  const pinkFill = (d, len, amp = 1) => {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11 * amp;
      b6 = w * 0.115926;
    }
  };
  const brownFill = (d, len) => {
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
  };
  const B = {};
  B.white = make(3, (d, len) => { for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; });
  B.pink = make(3, (d, len) => { pinkFill(d, len); normalize(d, 0.8); });
  B.brown = make(4, (d, len) => { brownFill(d, len); normalize(d, 0.9); });
  // Rolling textures ------------------------------------------------------------
  // smooth: pink noise with a gentle slow amplitude wander (fresh skatepark concrete / tile)
  B.smooth = make(4, (d, len) => {
    pinkFill(d, len);
    let a = 1, ta = 1;
    for (let i = 0; i < len; i++) {
      if (i % 2000 === 0) ta = 0.8 + Math.random() * 0.35;
      a += (ta - a) * 0.0008;
      d[i] *= a;
    }
    normalize(d, 0.7);
  });
  // grain: pink + sparse micro-impacts (aggregate in the concrete)
  B.grain = make(4, (d, len) => {
    pinkFill(d, len, 0.8);
    const n = Math.floor(len / sr * 900);
    for (let k = 0; k < n; k++) {
      const p = Math.floor(Math.random() * (len - 200));
      const amp = (Math.random() ** 3) * 1.4 * (Math.random() < 0.5 ? -1 : 1);
      const dec = 20 + Math.random() * 60;
      for (let j = 0; j < 160; j++) d[p + j] += amp * Math.exp(-j / dec) * (Math.random() * 2 - 1);
    }
    normalize(d, 0.8);
  });
  // rough: dense coarse grit + low bumps (asphalt / brick)
  B.rough = make(4, (d, len) => {
    pinkFill(d, len, 0.6);
    const n = Math.floor(len / sr * 2600);
    for (let k = 0; k < n; k++) {
      const p = Math.floor(Math.random() * (len - 400));
      const amp = (Math.random() ** 2) * 1.2 * (Math.random() < 0.5 ? -1 : 1);
      const dec = 30 + Math.random() * 110;
      for (let j = 0; j < 360; j++) d[p + j] += amp * Math.exp(-j / dec) * (Math.random() * 2 - 1);
    }
    // slow low bumps
    let ph = 0;
    for (let i = 0; i < len; i++) { ph += (18 + 10 * Math.sin(i / sr * 1.3)) / sr; d[i] += Math.sin(ph * Math.PI * 2) * 0.12; }
    normalize(d, 0.85);
  });
  // dirt: brown base + gravel crunch
  B.dirt = make(4, (d, len) => {
    brownFill(d, len);
    normalize(d, 0.6);
    const n = Math.floor(len / sr * 700);
    for (let k = 0; k < n; k++) {
      const p = Math.floor(Math.random() * (len - 600));
      const amp = Math.random() * 0.8 * (Math.random() < 0.5 ? -1 : 1);
      const dec = 60 + Math.random() * 160;
      for (let j = 0; j < 600; j++) d[p + j] += amp * Math.exp(-j / dec) * (Math.random() * 2 - 1);
    }
    normalize(d, 0.8);
  });
  // vinyl crackle for the lo-fi bed
  B.crackle = make(5, (d, len) => {
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.015;
    const n = Math.floor(len / sr * 14);
    for (let k = 0; k < n; k++) {
      const p = Math.floor(Math.random() * (len - 100));
      const amp = (0.2 + Math.random() * 0.8) * (Math.random() < 0.5 ? -1 : 1);
      for (let j = 0; j < 40; j++) d[p + j] += amp * Math.exp(-j / 4) * (j % 2 ? -1 : 1);
    }
  });
  for (const k of ['smooth', 'grain', 'rough', 'dirt', 'pink', 'brown', 'white', 'crackle']) seam(B[k]);
  return B;
}

/** Synthetic stereo impulse response — small outdoor plaza slap + short tail. */
export function makeImpulse(ctx, seconds = 1.2) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 5.5) * 0.5;
    }
    // early reflections off nearby walls
    for (const [tt, g] of [[0.011 + c * 0.004, 0.6], [0.023 + c * 0.006, 0.4], [0.041 - c * 0.005, 0.3], [0.067, 0.2]]) {
      const p = Math.floor(tt * sr);
      for (let j = 0; j < 30; j++) d[p + j] += g * (Math.random() * 2 - 1) * Math.exp(-j / 6);
    }
  }
  return buf;
}

/** Shared node factory bound to a context. */
export function makeSynth(ctx, buffers) {
  const filt = (type, f, Q = 0.707, gain = 0) => {
    const n = ctx.createBiquadFilter();
    n.type = type;
    n.frequency.value = f;
    n.Q.value = Q;
    if (gain) n.gain.value = gain;
    return n;
  };
  const gainNode = (v = 1) => { const g = ctx.createGain(); g.gain.value = v; return g; };

  function env(g, t, peak, attack, decay, hold = 0) {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(EPS, t);
    if (attack > 0.0005) g.gain.exponentialRampToValueAtTime(Math.max(peak, EPS * 2), t + attack);
    else g.gain.setValueAtTime(Math.max(peak, EPS * 2), t);
    if (hold > 0) g.gain.setValueAtTime(Math.max(peak, EPS * 2), t + attack + hold);
    g.gain.exponentialRampToValueAtTime(EPS, t + attack + hold + decay);
    return t + attack + hold + decay;
  }

  /**
   * Filtered noise burst.
   * opts: { t, buf:'white'|'pink'|..., filters:[[type, f, Q, fEnd?, gainDb?]], gain, attack, decay, hold, rate, dest, curve }
   */
  function noise({ t, buf = 'white', filters = [], gain = 0.5, attack = 0.002, decay = 0.1, hold = 0, rate = 1, dest, curve = null }) {
    const b = buffers[buf] || buffers.white;
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = rate;
    let node = src;
    const total = attack + hold + decay;
    for (const [type, f, Q = 0.707, fEnd, dB] of filters) {
      const fl = filt(type, f, Q, dB);
      if (fEnd) {
        fl.frequency.setValueAtTime(f, t);
        fl.frequency.exponentialRampToValueAtTime(fEnd, t + total);
      }
      node.connect(fl);
      node = fl;
    }
    const g = gainNode(0);
    node.connect(g);
    g.connect(dest);
    let end;
    if (curve) {
      const c = new Float32Array(curve.length);
      for (let i = 0; i < c.length; i++) c[i] = curve[i] * gain;
      c[0] = 0;
      g.gain.setValueCurveAtTime(c, t, total);
      end = t + total;
    } else {
      end = env(g, t, gain, attack, decay, hold);
    }
    const off = Math.random() * Math.max(0, b.duration - total * rate - 0.05);
    src.start(t, off);
    src.stop(end + 0.05);
    return end;
  }

  /** Oscillator tone with optional pitch glide. */
  function tone({ t, type = 'sine', f = 440, fEnd, glide, gain = 0.3, attack = 0.002, decay = 0.1, hold = 0, dest, filter, detune = 0 }) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    o.detune.value = detune;
    if (fEnd) o.frequency.exponentialRampToValueAtTime(Math.max(1, fEnd), t + (glide ?? attack + hold + decay));
    let node = o;
    if (filter) {
      const fl = filt(...filter);
      node.connect(fl);
      node = fl;
    }
    const g = gainNode(0);
    node.connect(g);
    g.connect(dest);
    const end = env(g, t, gain, attack, decay, hold);
    o.start(t);
    o.stop(end + 0.05);
    return end;
  }

  /** Looping buffer source (for continuous layers). */
  function loop(buf, rate = 1) {
    const src = ctx.createBufferSource();
    src.buffer = buffers[buf] || buffers.white;
    src.loop = true;
    src.playbackRate.value = rate;
    if (src.buffer._loopStart) { src.loopStart = src.buffer._loopStart; src.loopEnd = src.buffer.duration; }
    src.start(ctx.currentTime, Math.random() * src.buffer.duration * 0.9);
    return src;
  }

  return { filt, gain: gainNode, env, noise, tone, loop };
}

/** smoothly approach a target on an AudioParam */
export function glide(param, value, t, tc = 0.05) {
  param.setTargetAtTime(value, t, tc);
}
