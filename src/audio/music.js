// Generative music bed: a quiet city ambience (traffic hum, passing cars, birds) and an
// optional soft lo-fi beat. All original, synthesized on the fly. Runs on the music bus.
import { rand } from './synth.js';

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// warm 4-bar progression: Fmaj9 · Em7 · Dm9 · Cmaj7(add9)
const CHORDS = [
  { root: 41, notes: [57, 60, 64, 67] },
  { root: 40, notes: [55, 59, 62, 67] },
  { root: 38, notes: [57, 60, 64, 65] },
  { root: 36, notes: [55, 59, 62, 64] },
];

export function createMusic(ctx, S, buffers, out) {
  const ambient = S.gain(0.0);
  const beat = S.gain(0.0);
  const tape = S.filt('lowpass', 3800, 0.5);
  const tapeHp = S.filt('highpass', 45, 0.7);
  beat.connect(tape); tape.connect(tapeHp); tapeHp.connect(out);
  ambient.connect(out);

  let started = false;
  let enabled = { ambient: true, beat: true };
  let level = 0;
  const layers = [];

  function startBeds() {
    if (started) return;
    started = true;
    // distant city hum
    const hum = S.loop('brown', 0.6);
    const humLp = S.filt('lowpass', 180, 0.6);
    const humG = S.gain(0.5);
    hum.connect(humLp); humLp.connect(humG); humG.connect(ambient);
    // far-away air / leaves
    const air = S.loop('pink', 0.5);
    const airBp = S.filt('bandpass', 900, 0.4);
    const airG = S.gain(0.05);
    air.connect(airBp); airBp.connect(airG); airG.connect(ambient);
    // vinyl crackle for the beat
    const cr = S.loop('crackle', 1);
    const crG = S.gain(0.5);
    const crBp = S.filt('highpass', 900, 0.5);
    cr.connect(crBp); crBp.connect(crG); crG.connect(beat);
    layers.push(hum, air, cr);
  }

  // ---------------- ambience events
  let nextCar = 0, nextBird = 0;
  function car(t) {
    const dur = rand(3, 6);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const dest = pan || ambient;
    if (pan) {
      const dir = Math.random() < 0.5 ? -1 : 1;
      pan.pan.setValueAtTime(-0.8 * dir, t);
      pan.pan.linearRampToValueAtTime(0.8 * dir, t + dur);
      pan.connect(ambient);
    }
    const f0 = rand(380, 620);
    const curve = new Float32Array(32).map((_, i) => Math.pow(Math.sin((i / 31) * Math.PI), 2.2));
    S.noise({ t, buf: 'pink', filters: [['bandpass', f0 * 1.15, 0.7, f0 * 0.82], ['lowpass', 1600]], gain: rand(0.12, 0.25), attack: 0, decay: dur, dest, curve });
  }
  function bird(t) {
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) { pan.pan.value = rand(-0.9, 0.9); pan.connect(ambient); }
    const dest = pan || ambient;
    const base = rand(2600, 4200);
    const n = 2 + Math.floor(Math.random() * 4);
    let tt = t;
    for (let i = 0; i < n; i++) {
      const up = Math.random() < 0.6;
      const d = rand(0.05, 0.11);
      S.tone({ t: tt, f: base * (up ? 0.85 : 1.15), fEnd: base * (up ? 1.2 : 0.8), glide: d, gain: rand(0.012, 0.03), attack: 0.008, decay: d, dest });
      tt += d + rand(0.03, 0.09);
    }
  }

  // ---------------- beat
  const BPM = 78;
  const sixteenth = 60 / BPM / 4;
  let step = 0, bar = 0, nextStep = 0;
  function kick(t, v) {
    S.tone({ t, f: 128, fEnd: 44, glide: 0.11, gain: 0.55 * v, attack: 0.002, decay: 0.32, dest: beat });
    S.noise({ t, filters: [['lowpass', 1200]], gain: 0.05 * v, decay: 0.015, dest: beat });
  }
  function snare(t, v) {
    S.noise({ t, buf: 'white', filters: [['bandpass', 1900, 0.7], ['lowpass', 5200]], gain: 0.22 * v, decay: 0.2, dest: beat });
    S.tone({ t, type: 'triangle', f: 210, fEnd: 170, gain: 0.12 * v, decay: 0.08, dest: beat });
  }
  function hat(t, v, open = false) {
    S.noise({ t, buf: 'white', filters: [['highpass', 7200, 0.7], ['bandpass', 9500, 0.8]], gain: 0.07 * v, decay: open ? 0.16 : 0.035, dest: beat });
  }
  function keys(t, notes, dur) {
    for (const m of notes) {
      const f = mtof(m);
      const det = rand(-7, 7);
      S.tone({ t: t + rand(0, 0.025), f, type: 'sine', gain: 0.035, attack: 0.012, decay: dur, detune: det, dest: beat });
      S.tone({ t: t + rand(0, 0.025), f: f * 2, type: 'sine', gain: 0.008, attack: 0.004, decay: dur * 0.35, detune: det, dest: beat });
      S.tone({ t, f, type: 'triangle', gain: 0.012, attack: 0.03, decay: dur * 0.8, detune: -det, dest: beat, filter: ['lowpass', 1400, 0.5] });
    }
  }
  function bass(t, m, dur) {
    S.tone({ t, f: mtof(m), type: 'sine', gain: 0.2, attack: 0.01, decay: dur, dest: beat });
    S.tone({ t, f: mtof(m) * 2, type: 'triangle', gain: 0.025, attack: 0.01, decay: dur * 0.5, dest: beat, filter: ['lowpass', 600] });
  }
  function scheduleStep(s, t) {
    const chord = CHORDS[bar % 4];
    const breakdown = bar % 8 === 7;
    if (s === 0) keys(t, chord.notes, sixteenth * 14);
    if (s === 10 && Math.random() < 0.5) keys(t, chord.notes.slice(1), sixteenth * 5);
    if (s === 0) bass(t, chord.root + 12, sixteenth * 6);
    if (s === 10) bass(t, chord.root + 12 + (Math.random() < 0.3 ? 7 : 0), sixteenth * 4);
    if (breakdown) { if (s % 4 === 0) hat(t, 0.5); return; }
    if (s === 0 || (s === 7 && Math.random() < 0.6) || s === 10) kick(t, s === 0 ? 1 : 0.8);
    if (s === 4 || s === 12) snare(t, 1);
    if (s % 2 === 0) hat(t, s % 4 === 0 ? 0.9 : 0.55, s === 14 && Math.random() < 0.3);
    else if (Math.random() < 0.2) hat(t, 0.3);
  }

  function tick() {
    if (ctx.state !== 'running' || level < 0.001) {
      nextStep = 0;
      return;
    }
    startBeds();
    const now = ctx.currentTime;
    if (enabled.ambient) {
      if (!nextCar) nextCar = now + rand(1, 4);
      if (!nextBird) nextBird = now + rand(1, 3);
      if (now > nextCar) { car(now + 0.05); nextCar = now + rand(5, 14); }
      if (now > nextBird) { bird(now + 0.05); nextBird = now + rand(2.5, 11); }
    }
    if (enabled.beat) {
      if (!nextStep || nextStep < now) nextStep = now + 0.08;
      while (nextStep < now + 0.2) {
        const swing = step % 2 === 1 ? sixteenth * 0.28 : 0;
        scheduleStep(step, nextStep + swing);
        nextStep += sixteenth;
        step = (step + 1) % 16;
        if (step === 0) bar++;
      }
    }
  }
  const iv = setInterval(() => { try { tick(); } catch (e) { /* never throw from a timer */ } }, 40);

  function setLevel(v) {
    level = v;
    const t = ctx.currentTime;
    ambient.gain.setTargetAtTime(enabled.ambient ? 0.55 : 0, t, 0.3);
    beat.gain.setTargetAtTime(enabled.beat ? 0.9 : 0, t, 0.3);
  }
  function setEnabled(o) {
    enabled = { ...enabled, ...o };
    setLevel(level);
  }
  function dispose() {
    clearInterval(iv);
    for (const l of layers) try { l.stop(); } catch { /* */ }
  }
  return { setLevel, setEnabled, dispose };
}
