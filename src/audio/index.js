// SK8.IO — procedural skateboard audio (CONTRACTS.md §5). 100% WebAudio synthesis, no files.
import { makeBuffers, makeImpulse, makeSynth, clamp, lerp, rand } from './synth.js';
import { createMusic } from './music.js';

// Rolling character per surface.
//  tex: texture buffer · lp: lowpass range [slow, fast] · gain: level · rumble: low end amount
//  peaks: resonances [freq, Q, dB] · joint: spacing (m) of expansion joints / brick seams · jointGain
const SURF = {
  smoothConcrete: { tex: 'smooth', lp: [900, 5200], gain: 0.5, rumble: 0.3, roar: 0.8, joint: 7, jointGain: 0.3 },
  concrete: { tex: 'grain', lp: [1100, 6500], gain: 0.75, rumble: 0.55, roar: 1, joint: 1.55, jointGain: 0.75 },
  tile: { tex: 'smooth', lp: [1300, 7000], gain: 0.55, rumble: 0.45, roar: 0.9, joint: 0.6, jointGain: 0.3 },
  asphalt: { tex: 'rough', lp: [900, 5200], gain: 1.0, rumble: 1.1, roar: 1.1, joint: 0 },
  wood: { tex: 'smooth', lp: [600, 3400], gain: 0.62, rumble: 0.9, roar: 0.7, joint: 0, peaks: [[155, 5, 10], [310, 6, 7], [720, 4, 3]] },
  metal: { tex: 'grain', lp: [2200, 9000], gain: 0.5, rumble: 0.35, roar: 0.6, joint: 0, peaks: [[1870, 22, 13], [3150, 26, 11], [4720, 30, 8]] },
  brick: { tex: 'rough', lp: [700, 4200], gain: 0.75, rumble: 0.95, roar: 0.9, joint: 0.21, jointGain: 0.45 },
  grass: { tex: 'dirt', lp: [260, 800], gain: 0.55, rumble: 0.5, roar: 0.15, joint: 0 },
  dirt: { tex: 'dirt', lp: [420, 1700], gain: 0.8, rumble: 0.8, roar: 0.3, joint: 0 },
};

const GRIND_LEVEL = { metal: 1, concrete: 1.35, wood: 2.3 };

const NAMES = ['pop', 'land', 'landHard', 'catch', 'flip', 'bail', 'push', 'grindStart', 'slideStart', 'boardHit',
  'footBrake', 'uiClick', 'uiHover', 'uiBack', 'placeObject', 'removeObject', 'whoosh'];

function stub() {
  const noop = () => {};
  return {
    available: false, context: null, output: null, state: 'unavailable', sounds: NAMES.slice(),
    resume: noop, setVolumes: noop, update: noop, play: noop, setMusic: noop, dispose: noop,
  };
}

export function createAudio() {
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return stub();
  // The AudioContext is created lazily inside the first user gesture (resume() or the automatic
  // unlock below) so browsers never log autoplay warnings and nothing is queued while locked.
  let eng = null;
  let failed = false;
  const vols = { master: 0.8, sfx: 1, music: 0.35 };
  let musicOpts = null;
  function ensure() {
    if (eng || failed) return eng;
    try {
      const ctx = new AC({ latencyHint: 'interactive' });
      eng = build(ctx);
      eng.setVolumes(vols);
      if (musicOpts) eng.setMusic(musicOpts);
    } catch (e) {
      failed = true;
      console.warn('[audio] WebAudio unavailable, running silent', e);
    }
    return eng;
  }
  const evs = ['pointerdown', 'keydown', 'touchend', 'mousedown'];
  const unlock = () => { api.resume(); if (failed || (eng && eng.context.state === 'running')) detach(); };
  const detach = () => evs.forEach((e) => window.removeEventListener(e, unlock, true));
  evs.forEach((e) => window.addEventListener(e, unlock, true));

  const api = {
    available: true,
    sounds: NAMES.slice(),
    /** AudioContext (null until the first resume()/gesture). */
    get context() { return eng ? eng.context : null; },
    /** final output node (post-limiter, post-master volume) — tap it for meters / recording. */
    get output() { return eng ? eng.output : null; },
    get state() { return eng ? eng.context.state : failed ? 'unavailable' : 'locked'; },
    resume() { const e = ensure(); if (e) e.resume(); },
    setVolumes(v) {
      if (!v) return;
      for (const k of ['master', 'sfx', 'music']) if (Number.isFinite(v[k])) vols[k] = Math.max(0, Math.min(1, v[k]));
      if (eng) eng.setVolumes(vols);
    },
    update(dt, s) { if (eng) eng.update(dt, s); },
    play(name, intensity = 1, variant) { if (eng) eng.play(name, intensity, variant); },
    /** extra: { ambient: bool, beat: bool } — music bus layers (both on by default). */
    setMusic(o) { musicOpts = { ...(musicOpts || {}), ...(o || {}) }; if (eng) eng.setMusic(musicOpts); },
    dispose() { detach(); if (eng) eng.dispose(); eng = null; },
  };
  return api;
}

function build(ctx) {
  const buffers = makeBuffers(ctx);
  const S = makeSynth(ctx, buffers);
  const now = () => ctx.currentTime;

  // ------------------------------------------------------------------ mix bus
  //  loops ─┐
  //  shots ─┼─ sfx ─┐
  //  ui    ─┘       ├─ comp ─ limiter ─ master ─ out
  //  reverb ────────┤
  //  music ─────────┘
  const master = S.gain(0.8);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18; comp.knee.value = 10; comp.ratio.value = 3.5; comp.attack.value = 0.004; comp.release.value = 0.18;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -2; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.001; limiter.release.value = 0.06;
  comp.connect(limiter); limiter.connect(master); master.connect(ctx.destination);
  const sfx = S.gain(1); sfx.connect(comp);
  const music = S.gain(0.35); music.connect(comp);
  const loops = S.gain(1); loops.connect(sfx);
  const shots = S.gain(1); shots.connect(sfx);
  const uiBus = S.gain(0.8); uiBus.connect(sfx);
  const verb = ctx.createConvolver();
  verb.buffer = makeImpulse(ctx);
  const verbIn = S.gain(0.13); const verbOut = S.gain(0.9);
  const verbHp = S.filt('highpass', 220, 0.7);
  shots.connect(verbIn); verbIn.connect(verbHp); verbHp.connect(verb); verb.connect(verbOut); verbOut.connect(sfx);

  const mus = createMusic(ctx, S, buffers, music);
  let vol = { master: 0.8, sfx: 1, music: 0.35 };

  // ------------------------------------------------------------------ continuous layers
  // shared roll "roar" (wheels on ground) and rumble (low end through the deck)
  const roarSrc = S.loop('pink');
  const roarBp = S.filt('bandpass', 400, 0.9);
  const roarLp = S.filt('lowpass', 3000, 0.5);
  const roarG = S.gain(0);
  roarSrc.connect(roarBp); roarBp.connect(roarLp); roarLp.connect(roarG); roarG.connect(loops);
  const rumbleSrc = S.loop('brown');
  const rumbleLp = S.filt('lowpass', 90, 0.9);
  const rumbleG = S.gain(0);
  rumbleSrc.connect(rumbleLp); rumbleLp.connect(rumbleG); rumbleG.connect(loops);

  // per-surface texture chains, created lazily and retired when silent for a while
  const surfChains = {};
  function surfChain(name) {
    let c = surfChains[name];
    if (c) return c;
    const P = SURF[name];
    const src = S.loop(P.tex);
    const lp = S.filt('lowpass', P.lp[0], 0.6);
    const hp = S.filt('highpass', name === 'grass' || name === 'dirt' ? 60 : 140, 0.7);
    let node = lp;
    src.connect(hp); hp.connect(lp);
    for (const [f, Q, dB] of P.peaks || []) {
      const pk = S.filt('peaking', f, Q, dB);
      node.connect(pk); node = pk;
    }
    const g = S.gain(0);
    node.connect(g); g.connect(loops);
    c = surfChains[name] = { src, lp, g, P, silentFor: 0, level: 0 };
    return c;
  }

  // wind (speed + air)
  const windSrc = S.loop('pink', 0.8);
  const windBp = S.filt('bandpass', 400, 0.55);
  const windLp = S.filt('lowpass', 2500, 0.5);
  const windG = S.gain(0);
  const gustSrc = S.loop('brown', 0.25);
  const gustLp = S.filt('lowpass', 2, 0.5);
  const gustDepth = S.gain(0);
  windSrc.connect(windBp); windBp.connect(windLp); windLp.connect(windG); windG.connect(loops);
  gustSrc.connect(gustLp); gustLp.connect(gustDepth); gustDepth.connect(windG.gain);

  // grind / slide chains (lazy)
  const grindChains = {};
  function grindChain(kind) {
    let c = grindChains[kind];
    if (c) return c;
    const out = S.gain(0);
    out.connect(loops);
    // grit: slow random amplitude modulation (stick-slip chatter)
    const grit = S.gain(0.7);
    const lfo = S.loop('brown', kind === 'concrete' ? 4 : 2.5);
    const lfoLp = S.filt('lowpass', kind === 'concrete' ? 45 : 28, 0.6);
    const lfoG = S.gain(kind === 'concrete' ? 0.65 : 0.4);
    lfo.connect(lfoLp); lfoLp.connect(lfoG); lfoG.connect(grit.gain);
    grit.connect(out);
    const ring = S.gain(1);
    const scrape = S.gain(1);
    ring.connect(grit); scrape.connect(grit);
    const bands = [];
    if (kind === 'metal') {
      const src = S.loop('white');
      const hp = S.filt('highpass', 500, 0.7);
      src.connect(hp);
      for (const [f, Q, g] of [[1650, 12, 0.55], [2870, 16, 0.5], [4310, 18, 0.38], [6080, 14, 0.25], [7900, 10, 0.12]]) {
        const bp = S.filt('bandpass', f, Q);
        const bg = S.gain(g * 2.4);
        hp.connect(bp); bp.connect(bg); bg.connect(ring);
        bands.push([bp, f]);
      }
      const sc = S.filt('bandpass', 3200, 0.6);
      const scG = S.gain(0.22);
      hp.connect(sc); sc.connect(scG); scG.connect(scrape);
      bands.push([sc, 3200]);
      // wood-on-metal (board slides) body
      const wsrc = S.loop('pink');
      const wbp = S.filt('bandpass', 700, 0.8);
      const wG = S.gain(0.5);
      wsrc.connect(wbp); wbp.connect(wG); wG.connect(scrape);
      c = { out, ring, scrape, bands, srcs: [src, wsrc, lfo] };
    } else if (kind === 'concrete') {
      const src = S.loop('rough', 1.4);
      const hp = S.filt('highpass', 300, 0.7);
      const bp = S.filt('bandpass', 1300, 0.55);
      const pk = S.filt('peaking', 2600, 2, 5);
      src.connect(hp); hp.connect(bp); bp.connect(pk); pk.connect(scrape);
      const src2 = S.loop('white');
      const bp2 = S.filt('bandpass', 3800, 1.2);
      const g2 = S.gain(0.18);
      src2.connect(bp2); bp2.connect(g2); g2.connect(ring);
      bands.push([bp, 1300], [bp2, 3800]);
      c = { out, ring, scrape, bands, srcs: [src, src2, lfo] };
    } else {
      // wood
      const src = S.loop('grain', 1.2);
      const bp = S.filt('bandpass', 620, 0.8);
      const pk1 = S.filt('peaking', 210, 4, 8);
      const pk2 = S.filt('peaking', 440, 5, 5);
      src.connect(bp); bp.connect(pk1); pk1.connect(pk2); pk2.connect(scrape);
      const src2 = S.loop('pink');
      const bp2 = S.filt('bandpass', 1800, 1.4);
      const g2 = S.gain(0.25);
      src2.connect(bp2); bp2.connect(g2); g2.connect(ring);
      bands.push([bp, 620], [bp2, 1800]);
      c = { out, ring, scrape, bands, srcs: [src, src2, lfo] };
    }
    grindChains[kind] = c;
    return c;
  }

  // powerslide: urethane scrape + squeal
  let psChain = null;
  function powerslideChain() {
    if (psChain) return psChain;
    const out = S.gain(0);
    out.connect(loops);
    const src = S.loop('grain', 1.3);
    const bp = S.filt('bandpass', 1100, 0.7);
    const g1 = S.gain(0.9);
    src.connect(bp); bp.connect(g1); g1.connect(out);
    const src2 = S.loop('white');
    const bp2 = S.filt('bandpass', 2900, 3.5);
    const g2 = S.gain(0.5);
    src2.connect(bp2); bp2.connect(g2); g2.connect(out);
    // squeal: a wobbling partial excited by stick-slip
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 1150;
    const wob = S.loop('brown', 3);
    const wobLp = S.filt('lowpass', 14);
    const wobG = S.gain(90);
    wob.connect(wobLp); wobLp.connect(wobG); wobG.connect(osc.frequency);
    const oBp = S.filt('bandpass', 1200, 9);
    const oG = S.gain(0.0);
    const trem = S.gain(0.6);
    const tSrc = S.loop('brown', 6); const tLp = S.filt('lowpass', 30); const tG = S.gain(0.5);
    tSrc.connect(tLp); tLp.connect(tG); tG.connect(trem.gain);
    osc.connect(oBp); oBp.connect(oG); oG.connect(trem); trem.connect(out);
    osc.start();
    psChain = { out, osc, oG, bp, bp2 };
    return psChain;
  }

  // ------------------------------------------------------------------ one-shots
  const N = (o) => S.noise({ dest: shots, ...o });
  const T = (o) => S.tone({ dest: shots, ...o });
  const U = (o) => S.tone({ dest: uiBus, ...o });
  let lastSurface = 'concrete';
  let lastGrind = 'metal';
  let lastSliding = false;
  let curSpeed = 0;

  function woodKnock(t, v, f = 520) {
    N({ t, buf: 'white', filters: [['bandpass', f, 6]], gain: 0.9 * v, decay: 0.09 });
    T({ t, type: 'triangle', f: f * 0.55, fEnd: f * 0.5, gain: 0.25 * v, decay: 0.07 });
    N({ t, filters: [['highpass', 3000]], gain: 0.25 * v, decay: 0.012 });
  }
  function metalClink(t, v, f = 2200) {
    for (const [r, g, d] of [[1, 1, 0.18], [2.76, 0.5, 0.12], [5.4, 0.25, 0.07]]) T({ t, f: f * r, gain: 0.05 * v * g, attack: 0.001, decay: d });
  }
  function clack(t, v) {
    // wheels hitting an expansion joint / brick seam: short click + low deck thump
    N({ t, filters: [['bandpass', rand(1300, 1900), 1.1]], gain: 0.35 * v, decay: 0.022 });
    T({ t, f: 105, fEnd: 62, gain: 0.45 * v, decay: 0.07 });
    N({ t, buf: 'pink', filters: [['bandpass', 340, 2.5]], gain: 0.3 * v, decay: 0.05 });
  }

  const SHOTS = {
    pop(t, v) {
      // tail snap
      N({ t, filters: [['highpass', 1300], ['bandpass', 2700, 0.9]], gain: 1.1 * v, attack: 0.0008, decay: 0.035 });
      N({ t, filters: [['bandpass', 5200, 1.2]], gain: 0.35 * v, decay: 0.015 });
      // wood body resonance
      N({ t, filters: [['bandpass', rand(680, 760), 7]], gain: 1.2 * v, decay: 0.12 });
      T({ t, type: 'triangle', f: 390, fEnd: 330, gain: 0.22 * v, decay: 0.07 });
      // thump
      T({ t, f: rand(165, 195), fEnd: 70, glide: 0.07, gain: 0.85 * v, decay: 0.1 });
      // grip-tape scuff of the front foot sliding up
      N({ t: t + 0.025, buf: 'pink', filters: [['bandpass', 3600, 1]], gain: 0.16 * v, attack: 0.02, decay: 0.11 });
    },
    flip(t, v) {
      // board flutter: spinning deck chopping air
      const dur = 0.32;
      const rate = rand(13, 17);
      const n = 64;
      const curve = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = i / (n - 1);
        const pulses = Math.pow(Math.abs(Math.sin(x * dur * rate * Math.PI)), 3);
        curve[i] = (0.25 + 0.75 * pulses) * Math.sin(x * Math.PI) ** 0.6;
      }
      N({ t, buf: 'pink', filters: [['bandpass', 750, 1.1, 1100]], gain: 0.9 * v, attack: 0, decay: dur, curve });
      N({ t, buf: 'pink', filters: [['bandpass', 2400, 1.5]], gain: 0.12 * v, attack: 0.03, decay: 0.2 });
    },
    catch(t, v) {
      N({ t, filters: [['bandpass', 1800, 1.4]], gain: 0.4 * v, decay: 0.025 });
      T({ t, f: 150, fEnd: 105, gain: 0.35 * v, decay: 0.045 });
      N({ t: t + 0.012, buf: 'pink', filters: [['bandpass', 3000, 1]], gain: 0.12 * v, decay: 0.05 });
    },
    land(t, v) {
      const lp = 2200 + 2600 * clamp(v, 0, 1);
      // deck slap
      N({ t, filters: [['lowpass', lp], ['highpass', 160]], gain: 0.9 * v, attack: 0.001, decay: 0.07 });
      N({ t, filters: [['bandpass', rand(560, 640), 4]], gain: 0.7 * v, decay: 0.09 });
      // body / urethane thump
      T({ t, f: 92, fEnd: 44, glide: 0.12, gain: 1.0 * v, decay: 0.17 });
      // truck + bushing clunk (front, then back truck a hair later)
      for (const [dt, g] of [[0, 1], [rand(0.012, 0.024), 0.7]]) {
        N({ t: t + dt, filters: [['bandpass', rand(300, 360), 3]], gain: 0.55 * v * g, decay: 0.06 });
        T({ t: t + dt, type: 'triangle', f: rand(210, 240), fEnd: 160, gain: 0.18 * v * g, decay: 0.05 });
        metalClink(t + dt, 0.5 * v * g, rand(1900, 2500));
      }
    },
    landHard(t, v) {
      SHOTS.land(t, Math.min(1.4, v * 1.25));
      T({ t, f: 70, fEnd: 34, glide: 0.18, gain: 0.9 * v, decay: 0.28 });
      N({ t, filters: [['lowpass', 900]], gain: 0.6 * v, decay: 0.16 });
      // hardware rattle
      const n = 24;
      const curve = new Float32Array(n).map((_, i) => (Math.random() * 0.7 + 0.3) * Math.exp(-i / 7));
      N({ t: t + 0.01, filters: [['bandpass', 5200, 3]], gain: 0.3 * v, attack: 0, decay: 0.2, curve });
      metalClink(t + 0.03, 0.6 * v, rand(2600, 3200));
    },
    bail(t, v) {
      // body hits the ground
      T({ t, f: 78, fEnd: 38, glide: 0.2, gain: 1.0 * v, decay: 0.3 });
      N({ t, buf: 'pink', filters: [['lowpass', 520]], gain: 0.9 * v, attack: 0.003, decay: 0.24 });
      N({ t: t + 0.02, buf: 'pink', filters: [['bandpass', 2100, 0.9]], gain: 0.22 * v, attack: 0.01, decay: 0.2 }); // cloth scuff
      N({ t: t + 0.18, buf: 'pink', filters: [['bandpass', 1500, 0.8]], gain: 0.18 * v, attack: 0.04, decay: 0.35 }); // slide on ground
      // board clatter: tumbling knocks with shrinking gaps and energy
      let tt = t + rand(0.06, 0.12);
      let e = 1;
      let gap = rand(0.16, 0.22);
      for (let i = 0; i < 7; i++) {
        woodKnock(tt, 0.75 * v * e, rand(380, 760));
        if (Math.random() < 0.6) metalClink(tt + 0.004, 0.7 * v * e, rand(1800, 3000));
        if (Math.random() < 0.5) T({ t: tt, f: 120, fEnd: 70, gain: 0.25 * v * e, decay: 0.06 });
        tt += gap;
        gap *= rand(0.6, 0.85);
        e *= rand(0.55, 0.75);
      }
      // wheels roll away
      N({ t: tt, buf: 'grain', filters: [['bandpass', 900, 0.7], ['lowpass', 3000]], gain: 0.2 * v, attack: 0.02, decay: 0.7 });
    },
    push(t, v) {
      const soft = lastSurface === 'grass' || lastSurface === 'dirt';
      // foot plants
      T({ t, f: 88, fEnd: 60, gain: 0.32 * v, decay: 0.06 });
      N({ t, buf: 'pink', filters: [['lowpass', soft ? 600 : 1400]], gain: 0.25 * v, decay: 0.04 });
      // shoe sole scuffs along the ground
      N({ t: t + 0.02, buf: soft ? 'dirt' : 'rough', filters: [['bandpass', soft ? 700 : rand(1200, 1500), 0.9, soft ? 500 : 950]], gain: 0.45 * v, attack: 0.05, hold: 0.04, decay: 0.16 });
    },
    footBrake(t, v) {
      N({ t, buf: 'rough', filters: [['bandpass', 1900, 0.8, 850], ['highpass', 300]], gain: 0.55 * v, attack: 0.05, hold: 0.25, decay: 0.4 });
      N({ t, buf: 'pink', filters: [['bandpass', 3400, 1.5]], gain: 0.15 * v, attack: 0.06, hold: 0.2, decay: 0.3 });
    },
    boardHit(t, v) {
      woodKnock(t, v, rand(460, 560));
      T({ t, f: 140, fEnd: 80, gain: 0.35 * v, decay: 0.08 });
    },
    grindStart(t, v, kind = lastGrind) {
      const k = kind === 'coping' ? 'metal' : kind;
      T({ t, f: 120, fEnd: 60, gain: 0.7 * v, decay: 0.12 });
      N({ t, filters: [['highpass', 1800]], gain: 0.45 * v, decay: 0.035 });
      if (k === 'metal') {
        const f = kind === 'coping' ? 0.82 : 1;
        for (const [p, g, d] of [[1240, 1, 0.42], [2710, 0.6, 0.3], [4180, 0.35, 0.22], [5530, 0.2, 0.15]]) T({ t, f: p * f * rand(0.97, 1.03), gain: 0.07 * g * v, attack: 0.001, decay: d });
        N({ t, filters: [['bandpass', 2900, 6]], gain: 0.5 * v, decay: 0.12 });
      } else if (k === 'concrete') {
        N({ t, buf: 'rough', filters: [['bandpass', 1200, 0.7]], gain: 0.7 * v, decay: 0.12 });
      } else {
        woodKnock(t, 0.8 * v, 420);
      }
    },
    slideStart(t, v, kind = lastGrind) {
      woodKnock(t, 0.8 * v, rand(400, 480));
      T({ t, f: 110, fEnd: 55, gain: 0.6 * v, decay: 0.12 });
      const k = kind === 'coping' ? 'metal' : kind;
      if (k === 'metal') metalClink(t, 0.9 * v, rand(1500, 1900));
      N({ t, buf: k === 'concrete' ? 'rough' : 'pink', filters: [['bandpass', 1400, 0.8]], gain: 0.4 * v, attack: 0.01, decay: 0.15 });
    },
    whoosh(t, v) {
      N({ t, buf: 'pink', filters: [['bandpass', 380, 1.2, 1500]], gain: 0.5 * v, attack: 0.16, decay: 0.3 });
    },
    uiClick(t, v) {
      U({ t, f: 1750, fEnd: 1350, gain: 0.16 * v, decay: 0.045 });
      U({ t, f: 3700, gain: 0.05 * v, decay: 0.012 });
      S.noise({ t, dest: uiBus, filters: [['highpass', 4000]], gain: 0.08 * v, decay: 0.006 });
    },
    uiHover(t, v) {
      U({ t, f: 2600, fEnd: 2900, gain: 0.04 * v, decay: 0.022 });
    },
    uiBack(t, v) {
      U({ t, f: 1250, fEnd: 720, glide: 0.08, gain: 0.13 * v, decay: 0.09 });
      S.noise({ t, dest: uiBus, filters: [['highpass', 3500]], gain: 0.05 * v, decay: 0.006 });
    },
    placeObject(t, v) {
      T({ t, f: 120, fEnd: 52, glide: 0.12, gain: 0.7 * v, decay: 0.18 });
      N({ t, buf: 'pink', filters: [['lowpass', 900]], gain: 0.5 * v, decay: 0.12 });
      U({ t: t + 0.04, f: 880, gain: 0.07 * v, decay: 0.25 });
      U({ t: t + 0.1, f: 1320, gain: 0.06 * v, decay: 0.32 });
    },
    removeObject(t, v) {
      N({ t, buf: 'pink', filters: [['bandpass', 1600, 1.2, 380]], gain: 0.4 * v, attack: 0.02, decay: 0.26 });
      U({ t: t + 0.02, f: 1320, gain: 0.06 * v, decay: 0.18 });
      U({ t: t + 0.09, f: 880, gain: 0.06 * v, decay: 0.26 });
    },
    // internal: bearings still spinning when you leave the ground
    _airWhir(t, v) {
      N({ t, buf: 'white', filters: [['bandpass', 4300, 7]], gain: 0.18 * v, attack: 0.01, decay: 1.3 });
      N({ t, buf: 'pink', filters: [['bandpass', 1300, 3]], gain: 0.12 * v, attack: 0.01, decay: 0.7 });
    },
  };

  // voice budget (keeps CPU sane during bail tumbles + spammy UI)
  let voices = [];
  const MAX_VOICES = 40;

  function play(name, intensity = 1, variant) {
    try {
      if (ctx.state !== 'running') return; // don't queue sounds while locked
      const fn = SHOTS[name];
      if (!fn) return;
      const t = now();
      voices = voices.filter((e) => e > t);
      if (voices.length > MAX_VOICES && name !== 'bail' && name !== 'landHard') return;
      const v = clamp(Number.isFinite(intensity) ? intensity : 1, 0, 2);
      if (v <= 0) return;
      fn(t + 0.005, v, variant);
      voices.push(t + 0.4);
    } catch (e) {
      warnOnce(e);
    }
  }

  // ------------------------------------------------------------------ update
  let jointDist = 0;
  let nextJoint = 1.5;
  let wasGrounded = false;
  let wasAir = false;
  const state = { speed: 0 };

  function update(dt, s) {
    try {
      s = s || {};
      if (!(dt > 0)) dt = 1 / 60;
      dt = Math.min(dt, 0.1);
      const t = now();
      const speed = Math.max(0, Math.abs(Number(s.speed) || 0));
      curSpeed = speed;
      state.speed = speed;
      const grinding = s.grinding || null;
      const surface = SURF[s.surface] ? s.surface : (s.surface ? 'concrete' : lastSurface);
      lastSurface = surface;
      if (grinding) lastGrind = grinding;
      lastSliding = !!s.sliding;
      const airborne = !!s.airborne && !grinding;
      const rolling = !!s.grounded && !grinding && !airborne;
      const sN = clamp(speed / 12, 0, 1);
      const manualF = s.manual ? 0.72 : 1;
      const psF = s.powerslide ? 0.45 : 1;

      // rolling level: comes in fast at walking speed, then grows
      const roll = rolling ? clamp(speed / 1.2, 0, 1) * (0.28 + 0.72 * Math.pow(sN, 0.85)) * psF : 0;
      const P = SURF[surface];
      const TC = 0.06;
      roarG.gain.setTargetAtTime(roll * 0.5 * P.roar * manualF, t, TC);
      roarBp.frequency.setTargetAtTime(220 + speed * 42, t, 0.1);
      roarLp.frequency.setTargetAtTime(lerp(P.lp[0], P.lp[1], sN), t, 0.1);
      rumbleG.gain.setTargetAtTime(roll * 1.25 * P.rumble * (s.manual ? 0.6 : 1), t, TC);
      rumbleLp.frequency.setTargetAtTime(55 + speed * 9, t, 0.1);

      if (rolling && speed > 0.2) surfChain(surface);
      for (const [name, c] of Object.entries(surfChains)) {
        const target = name === surface ? roll * c.P.gain * manualF : 0;
        c.g.gain.setTargetAtTime(target, t, name === surface ? TC : 0.035);
        c.lp.frequency.setTargetAtTime(lerp(c.P.lp[0], c.P.lp[1], sN), t, 0.1);
        c.src.playbackRate.setTargetAtTime(0.72 + 0.65 * sN, t, 0.1);
        c.silentFor = target > 0.001 ? 0 : c.silentFor + dt;
        if (c.silentFor > 5) { try { c.src.stop(); } catch { /* */ } c.g.disconnect(); delete surfChains[name]; }
      }

      // expansion joints / seams: front wheels then back wheels (the classic "ka-tunk")
      if (rolling && P.joint && speed > 0.8 && !s.powerslide) {
        jointDist += speed * dt;
        if (jointDist >= nextJoint) {
          jointDist = 0;
          nextJoint = P.joint * rand(0.8, 1.2);
          const v = P.jointGain * clamp(speed / 7, 0.25, 1.1) * manualF;
          if (ctx.state === 'running') {
            clack(t + 0.002, v);
            const back = 0.36 / speed;
            if (!s.manual && back > 0.015 && back < 0.6) clack(t + back, v * 0.8);
          }
        }
      } else jointDist = 0;

      // grinds & slides
      for (const [kind, c] of Object.entries(grindChains)) {
        const active = grinding && (grinding === 'coping' ? 'metal' : grinding) === kind;
        const lvl = active ? (0.32 + 0.7 * clamp(speed / 7, 0, 1)) : 0;
        c.out.gain.setTargetAtTime(lvl * 0.9 * (GRIND_LEVEL[kind] || 1), t, active ? 0.03 : 0.05);
        if (active) {
          const sliding = !!s.sliding;
          c.ring.gain.setTargetAtTime(sliding ? 0.3 : 1, t, 0.05);
          c.scrape.gain.setTargetAtTime(sliding ? 1.6 : 0.8, t, 0.05);
          const fMul = (grinding === 'coping' ? 0.82 : 1) * (0.88 + 0.22 * clamp(speed / 8, 0, 1)) * (sliding ? 0.8 : 1);
          for (const [bp, f] of c.bands) bp.frequency.setTargetAtTime(f * fMul, t, 0.08);
        }
      }
      if (grinding) grindChain(grinding === 'coping' ? 'metal' : grinding);

      // powerslide
      if (s.powerslide && rolling) powerslideChain();
      if (psChain) {
        const on = s.powerslide && rolling;
        const lvl = on ? clamp(speed / 6, 0.15, 1.2) : 0;
        psChain.out.gain.setTargetAtTime(lvl * 0.55, t, on ? 0.04 : 0.08);
        const smooth = surface === 'smoothConcrete' || surface === 'tile' || surface === 'wood';
        psChain.oG.gain.setTargetAtTime(on && smooth ? 0.22 : on ? 0.06 : 0, t, 0.1);
        psChain.osc.frequency.setTargetAtTime(950 + speed * 35, t, 0.2);
        psChain.bp.frequency.setTargetAtTime(800 + speed * 60, t, 0.1);
      }

      // wind
      const w = Math.pow(clamp(speed / 16, 0, 1.3), 1.6) * 0.32 + (airborne ? 0.03 + 0.1 * sN : 0);
      windG.gain.setTargetAtTime(w, t, airborne ? 0.15 : 0.3);
      gustDepth.gain.setTargetAtTime(w * 0.6, t, 0.3);
      windBp.frequency.setTargetAtTime(260 + speed * 38 + (airborne ? 150 : 0), t, 0.25);

      // leaving the ground with speed: bearings whir down
      if (airborne && !wasAir && wasGrounded && speed > 3) play('_airWhir', clamp(speed / 10, 0.3, 1));
      wasAir = airborne;
      wasGrounded = rolling;
    } catch (e) {
      warnOnce(e);
    }
  }

  let warned = false;
  function warnOnce(e) {
    if (warned) return;
    warned = true;
    console.warn('[audio]', e);
  }

  function setVolumes(v) {
    try {
      const { master: m, sfx: s, music: mu } = v || {};
      if (Number.isFinite(m)) vol.master = clamp(m, 0, 1);
      if (Number.isFinite(s)) vol.sfx = clamp(s, 0, 1);
      if (Number.isFinite(mu)) vol.music = clamp(mu, 0, 1);
      const t = now();
      // perceptual curve
      master.gain.setTargetAtTime(Math.pow(vol.master, 1.6), t, 0.03);
      sfx.gain.setTargetAtTime(Math.pow(vol.sfx, 1.6), t, 0.03);
      music.gain.setTargetAtTime(Math.pow(vol.music, 1.6) * 0.6, t, 0.08);
      mus.setLevel(vol.music);
    } catch (e) { warnOnce(e); }
  }
  setVolumes(vol);

  function resume() {
    try {
      if (ctx.state !== 'running') {
        const p = ctx.resume();
        if (p && p.catch) p.catch(() => {});
      }
    } catch { /* */ }
  }

  return {
    context: ctx,
    output: master,
    resume,
    setVolumes,
    update,
    play,
    setMusic(o) { try { mus.setEnabled(o || {}); } catch (e) { warnOnce(e); } },
    dispose() { try { mus.dispose(); ctx.close(); } catch { /* */ } },
  };
}
