// UI + audio preview harness. Open /src/ui/preview.html on the vite dev server.
// Query params: ?panel=0 hides the test panel, ?screen=<name> opens a screen, ?demo=1 fills the HUD.
import { createUI } from './index.js';
import { createAudio } from '../audio/index.js';

const params = new URLSearchParams(location.search);

// ---------------------------------------------------------------- fake 3D backdrop
const bg = document.getElementById('bg');
function drawBg() {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const W = (bg.width = innerWidth * dpr), H = (bg.height = innerHeight * dpr);
  const g = bg.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, H * 0.62);
  sky.addColorStop(0, '#1d2a3f'); sky.addColorStop(0.55, '#5d6a80'); sky.addColorStop(1, '#d9a27a');
  g.fillStyle = sky; g.fillRect(0, 0, W, H);
  // buildings
  let x = 0;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  while (x < W) {
    const w = (60 + rnd() * 160) * dpr, h = (80 + rnd() * 300) * dpr;
    g.fillStyle = `hsl(220, 12%, ${14 + rnd() * 10}%)`;
    g.fillRect(x, H * 0.62 - h, w, h);
    g.fillStyle = 'rgba(255,200,140,0.25)';
    for (let wy = H * 0.62 - h + 14 * dpr; wy < H * 0.62 - 20 * dpr; wy += 22 * dpr)
      for (let wx = x + 10 * dpr; wx < x + w - 14 * dpr; wx += 18 * dpr) if (rnd() < 0.3) g.fillRect(wx, wy, 7 * dpr, 10 * dpr);
    x += w + 6 * dpr;
  }
  // ground plaza
  const gr = g.createLinearGradient(0, H * 0.62, 0, H);
  gr.addColorStop(0, '#6f6b66'); gr.addColorStop(1, '#3a3836');
  g.fillStyle = gr; g.fillRect(0, H * 0.62, W, H);
  g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 1.5 * dpr;
  for (let i = -20; i <= 20; i++) { g.beginPath(); g.moveTo(W / 2 + i * 30 * dpr, H * 0.62); g.lineTo(W / 2 + i * 260 * dpr, H); g.stroke(); }
  for (let k = 0; k < 12; k++) { const y = H * 0.62 + Math.pow(k / 12, 2) * H * 0.38; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  // a ledge + rail
  g.fillStyle = '#8d8981'; g.fillRect(W * 0.58, H * 0.7, W * 0.3, H * 0.05);
  g.fillStyle = '#5c5953'; g.fillRect(W * 0.58, H * 0.75, W * 0.3, H * 0.03);
  g.strokeStyle = '#c9ccd2'; g.lineWidth = 5 * dpr; g.beginPath(); g.moveTo(W * 0.12, H * 0.74); g.lineTo(W * 0.4, H * 0.68); g.stroke();
}
drawBg();
addEventListener('resize', drawBg);

// ---------------------------------------------------------------- UI + audio
const logEl = document.createElement('div');
logEl.className = 'log';
function log(...a) { logEl.textContent = (a.join(' ') + '\n' + logEl.textContent).slice(0, 2000); }
const audio = createAudio();
const skater = document.getElementById('skater');
let rot = 0;
const fig = skater.querySelector('.fig');
const ui = createUI({
  root: document.getElementById('ui'),
  audio,
  previewHooks: {
    enter() { skater.classList.add('on'); },
    exit() { skater.classList.remove('on'); },
    rotate(d) { rot += d; fig.style.transform = `rotateY(${rot}rad)`; },
    tab(t) { log('preview tab', t); },
  },
});
window.ui = ui;
window.audio = audio;

const SPOTS = ['Plaza', 'Bowl', 'Vert Ramp', 'Big Stairs', 'Downhill', 'Ledge Park', 'Rooftop Gap'];
ui.setSpots(SPOTS.map((name) => ({ name })));
ui.setControlsHint('W push · mouse flick · Esc pause');

for (const ev of ['start', 'resume', 'customize', 'controls', 'settings', 'dropper', 'teleport', 'resetPlacedObjects', 'quit', 'appearance', 'board', 'screen']) {
  ui.on(ev, (...a) => log(ev, a.length ? JSON.stringify(a[0]).slice(0, 80) : ''));
}
ui.on('settings', (s) => audio.setVolumes({ master: s.masterVolume, sfx: s.sfxVolume, music: s.musicVolume }));
ui.on('start', () => audio.resume());
const s0 = ui.settings;
audio.setVolumes({ master: s0.masterVolume, sfx: s0.sfxVolume, music: params.has('music') ? +params.get('music') : 0 });

// ---------------------------------------------------------------- test panel
const tp = document.getElementById('tp');
const toggle = document.getElementById('tpToggle');
if (params.get('panel') === '0') { tp.classList.add('hidden'); toggle.style.display = 'none'; }
toggle.onclick = () => tp.classList.toggle('hidden');

const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const btn = (label, fn) => el('button', { textContent: label, onclick: fn });
const sec = (title, ...kids) => { tp.append(el('h5', { textContent: title }), ...kids); };

sec('Screens', ...['title', 'playing', 'paused', 'customize', 'controls', 'settings', 'dropper'].map((s) => btn(s, () => ui.show(s))));
sec('Gamepad nav', ...['up', 'down', 'left', 'right', 'confirm', 'back', 'prevTab', 'nextTab'].map((d) => btn(d, () => ui.navigate(d))));

const TRICKS = [['Kickflip', 'clean'], ['50-50 Grind', 'clean', '1.4 s'], ['Varial Heelflip', 'sketchy', 'Sketchy landing'], ['Nose Manual', 'clean'], ['360 Flip', 'clean', 'Late'], ['Boardslide', 'clean'], ['Hardflip', 'clean']];
let ti = 0;
sec('Tricks',
  btn('trick clean', () => { const t = TRICKS[ti++ % TRICKS.length]; ui.trick(t[0], { quality: t[1], sub: t[2] }); }),
  btn('sketchy', () => ui.trick('Inward Heelflip', { quality: 'sketchy', sub: 'Sketchy' })),
  btn('bail', () => ui.trick('', { quality: 'bail', sub: 'Pressure flip into the curb' })),
  btn('lineEnd', () => ui.lineEnd()),
  btn('toast', () => ui.toast(['Marker set', 'Controller connected', 'Teleported to Plaza'][Math.floor(Math.random() * 3)])));

let hud = { speedKmh: 0, gamepad: false, marker: false };
const spd = el('input', { type: 'range', min: 0, max: 60, value: 0, oninput: () => { hud.speedKmh = +spd.value; ui.setHud(hud); } });
sec('HUD',
  el('label', {}, 'speed', spd),
  btn('gamepad', () => { hud.gamepad = !hud.gamepad; ui.setHud(hud); }),
  btn('marker', () => { hud.marker = !hud.marker; ui.setHud(hud); }),
  btn('hint', () => ui.setControlsHint(Math.random() < 0.5 ? null : 'Hold W to push · pull mouse back to load')),
  btn('flick demo', () => flickDemo()));

const CATALOG = [
  { id: 'kicker', name: 'Kicker Ramp', category: 'Ramps' }, { id: 'qp', name: 'Quarter Pipe', category: 'Ramps' },
  { id: 'funbox', name: 'Funbox', category: 'Ramps' }, { id: 'rail', name: 'Flat Rail', category: 'Rails' },
  { id: 'kinked', name: 'Kinked Rail', category: 'Rails' }, { id: 'ledge', name: 'Granite Ledge', category: 'Ledges' },
  { id: 'manual', name: 'Manual Pad', category: 'Ledges' }, { id: 'bench', name: 'Park Bench', category: 'Street' },
  { id: 'cone', name: 'Traffic Cone', category: 'Props' }, { id: 'barrier', name: 'Jersey Barrier', category: 'Street' },
];
let dsel = 0, dvis = false;
const drop = () => ui.setDropper({ visible: dvis, items: CATALOG, selected: dsel, hint: 'Q / E select · Click place · X remove · F exit' });
sec('Dropper', btn('toggle', () => { dvis = !dvis; drop(); }), btn('◀', () => { dsel = (dsel + CATALOG.length - 1) % CATALOG.length; drop(); }), btn('▶', () => { dsel = (dsel + 1) % CATALOG.length; drop(); }));

// audio
const A = { speed: 0, grounded: true, surface: 'concrete', grinding: null, sliding: false, powerslide: false, airborne: false, manual: false };
const aspd = el('input', { type: 'range', min: 0, max: 20, step: 0.1, value: 0, oninput: () => { A.speed = +aspd.value; aspdV.textContent = A.speed.toFixed(1) + ' m/s'; } });
const aspdV = el('span', { textContent: '0 m/s' });
const surf = el('select', { onchange: () => (A.surface = surf.value) }, ...['smoothConcrete', 'concrete', 'asphalt', 'wood', 'metal', 'brick', 'tile', 'grass', 'dirt'].map((s) => el('option', { value: s, textContent: s, selected: s === 'concrete' })));
const grind = el('select', { onchange: () => (A.grinding = grind.value || null) }, ...['', 'metal', 'coping', 'concrete', 'wood'].map((s) => el('option', { value: s, textContent: s || '(none)' })));
const chk = (k) => el('label', {}, el('input', { type: 'checkbox', checked: A[k], onchange: (e) => (A[k] = e.target.checked) }), k);
const mv = el('input', { type: 'range', min: 0, max: 1, step: 0.05, value: 0, oninput: () => audio.setVolumes({ music: +mv.value }) });
sec('Audio loop',
  btn('resume()', () => audio.resume()),
  el('label', {}, 'speed', aspd, aspdV),
  el('label', {}, 'surface', surf, ' grind', grind),
  chk('grounded'), chk('airborne'), chk('sliding'), chk('powerslide'), chk('manual'),
  el('label', {}, 'music', mv));
sec('One-shots', ...audio.sounds.map((n) => btn(n, () => { audio.resume(); audio.play(n, 1); })));
sec('Event log', logEl);

let last = performance.now();
function frame(t) {
  const dt = (t - last) / 1000; last = t;
  audio.update(dt, A);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// flick stick demo: pull back then flick up-left (kickflip)
function flickDemo() {
  const path = [];
  for (let i = 0; i <= 12; i++) path.push([0, i / 12, i > 8]);
  for (let i = 0; i < 6; i++) path.push([0, 1, true]);
  for (let i = 0; i <= 10; i++) { const t = i / 10; path.push([-0.7 * t, 1 - 1.7 * t, false]); }
  for (let i = 0; i <= 10; i++) { const t = i / 10; path.push([-0.7 * (1 - t), -0.7 * (1 - t), false]); }
  let k = 0;
  const step = () => { const p = path[k++]; if (!p) return; ui.setFlickStick({ x: p[0], y: p[1], loaded: p[2] }); requestAnimationFrame(step); };
  step();
}

// deterministic demo state for screenshots
if (params.get('demo') === '1') {
  ui.show('playing');
  ui.setHud({ speedKmh: 23, gamepad: true, marker: true });
  ui.trick('Kickflip', { quality: 'clean' });
  ui.trick('50-50 Grind', { quality: 'clean' });
  ui.trick('Varial Heelflip', { quality: 'sketchy', sub: 'Sketchy landing' });
  ui.setFlickStick({ x: 0, y: 0.6, loaded: false });
  ui.setFlickStick({ x: 0, y: 1, loaded: true });
  ui.setFlickStick({ x: -0.35, y: 0.2, loaded: true });
  ui.toast('Marker set');
}
if (params.get('screen')) ui.show(params.get('screen'));
