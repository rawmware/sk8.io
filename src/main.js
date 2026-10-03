import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/barlow-condensed/latin-800.css';
import '@fontsource/barlow-condensed/latin-800-italic.css';
import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-600.css';
import '@fontsource/dm-sans/latin-700.css';
import './style.css';
import { SkatePhysics, SPAWNS, makeObstacles, baseHeight, clamp } from './physics.js';
import { ParkWorld } from './world.js';
import { Input } from './input.js';
import { SkateAudio } from './audio.js';

const $ = s => document.querySelector(s);
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Private browsing may disallow storage. */ } };
const defaults = { deck: '#c7f35e', wheels: '#efe6ce', grip: .7, light: 'day', quality: 'high', touch: 'auto', sound: true };
const saved = read('sk8.settings.v1', {});
const color = (v, fallback) => /^#[a-f\d]{6}$/i.test(v) ? v : fallback;
const settings = { ...defaults, ...saved, deck: color(saved.deck, defaults.deck), wheels: color(saved.wheels, defaults.wheels), grip: clamp(Number(saved.grip) || .7, .3, 1) };
const storedObjects = read('sk8.obstacles.v1', []);
const custom = (Array.isArray(storedObjects) ? storedObjects : []).filter(o => ['rail', 'ledge', 'ramp'].includes(o.type) && [o.x, o.z, o.yaw, o.height, o.length].every(Number.isFinite) && Math.abs(o.x) < 28 && Math.abs(o.z) < 29 && o.height > 0 && o.height < 3 && o.length > 0 && o.length < 12).slice(0, 24);
const obstacles = [...makeObstacles(), ...custom];
let best = Math.max(0, Number(read('sk8.best.v1', 0)) || 0);
let playing = false, paused = false, building = false, started = false, selectedSpawn = 'plaza';
let elapsed = 0, messageTime = 0, trickTime = 0, hudTimer = 0, accumulator = 0, last = performance.now();
const icons = {
  sound: '<path d="M11 5 6 9H3v6h3l5 4V5Zm4 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4.2 1.8c-1 .7-1.7 1-1.7 2.7m0 3h.01"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  board: '<rect x="8" y="2" width="8" height="20" rx="4" transform="rotate(35 12 12)"/><path d="m6 8 3 2m6 5 3 2"/>',
  build: '<path d="M3 19h18M5 19V9h5l9 10M5 5h5m-3-2v4"/>',
  reset: '<path d="M3 10a9 9 0 1 1 1 7M3 4v6h6"/>',
  camera: '<path d="M3 7h4l2-3h6l2 3h4v13H3V7Z"/><circle cx="12" cy="13" r="4"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
const iconButton = (id, name, label, shortcut = '') => `<button id="${id}" class="icon-button" title="${label}${shortcut ? ` (${shortcut})` : ''}" aria-label="${label}">${icon(name)}</button>`;

$('#app').innerHTML = `
  <header class="topbar">
    <a class="wordmark" href="#" aria-label="sk8.io home">sk8<span>.io</span><i></i></a>
    <div class="session-label"><span class="eyebrow">OPEN SESSION</span><strong>Harbor Park <span>/</span> <span id="zone-name">The plaza</span></strong></div>
    <nav class="toolbar" aria-label="Game controls">
      <span id="controller-status" class="controller-status">KEYBOARD + MOUSE</span>
      ${iconButton('sound-button', 'sound', 'Toggle sound')}
      ${iconButton('help-button', 'help', 'Controls')}
      ${iconButton('pause-button', 'pause', 'Pause session', 'Esc')}
    </nav>
  </header>

  <section id="welcome" class="welcome" aria-label="Start a session">
    <div class="park-label"><span class="live-dot"></span> DAY 7 / ROUGH BETA</div>
    <h1>Find your<br><em>line.</em></h1>
    <p>I was bored and wanted to try something new.<br>Rough beta — just an idea for now. Expect bugs.</p>
    <div class="spot-picker" role="group" aria-label="Choose your starting spot">
      <button class="spot active" data-spawn="plaza" aria-pressed="true"><span>01</span><strong>The plaza</strong><small>Rails & ledges</small></button>
      <button class="spot" data-spawn="bowl" aria-pressed="false"><span>02</span><strong>The bowl</strong><small>Flow & transitions</small></button>
      <button class="spot" data-spawn="street" aria-pressed="false"><span>03</span><strong>Street line</strong><small>Ramps & gaps</small></button>
    </div>
    <button id="start-button" class="primary start-button">Let's skate <span>↗</span></button>
    <div class="welcome-links"><button id="welcome-garage">Customize your board</button><span>•</span><button id="welcome-help">How to ride</button></div>
  </section>
  <div id="welcome-footer" class="welcome-footer"><span>ROUGH BETA · A RAWMWARE EXPERIMENT</span><span>KEYBOARD · TOUCH · CONTROLLER</span></div>

  <section id="play-hud" class="play-hud hidden" aria-label="Session information">
    <div class="score-panel"><span class="eyebrow">SESSION SCORE</span><strong id="total-score">0</strong><span class="best">BEST LINE <b id="best-score">${best.toLocaleString()}</b></span></div>
    <div class="line-panel" id="line-panel"><span id="trick-name">ROLL OUT</span><div><strong id="line-score">0</strong><b id="multiplier">×1</b></div><div class="line-meter"><i id="line-timer"></i></div></div>
    <aside class="session-card"><span class="eyebrow">TODAY'S SESSION</span><div><span>Distance</span><b id="distance">0 m</b></div><div><span>Landed tricks</span><b id="landed">0</b></div><div><span>Grinds</span><b id="grinds">0</b></div><span class="session-time" id="session-time">00:00</span></aside>
    <div class="bottom-hud">
      <div class="speedometer"><strong id="speed">0</strong><div><span>KM/H</span><span id="ride-state">ROLLING</span></div><div class="charge-track"><i id="charge-fill"></i></div></div>
      <div class="keyboard-hints"><span><kbd>W A S D</kbd> Ride</span><span><kbd>SPACE</kbd> Hold & release to ollie</span><span><kbd>J K U</kbd> Flip</span><span><kbd>G</kbd> Grind</span></div>
      <div class="bottom-actions">${iconButton('reset-button', 'reset', 'Reset position', 'R')}${iconButton('camera-button', 'camera', 'Switch camera', 'C')}${iconButton('garage-button', 'board', 'Board setup')}${iconButton('build-button', 'build', 'Place obstacles', 'B')}${iconButton('fullscreen-button', 'expand', 'Fullscreen')}</div>
    </div>
    <div id="touch-controls" class="touch-controls" aria-label="Touch controls">
      <div class="touch-left"><div id="steering" aria-label="Steer left and right"><span>‹</span><i id="stick-knob"></i><span>›</span></div><div class="touch-row"><button data-hold="brake">BRAKE</button><button data-hold="push" class="push-touch">PUSH</button></div></div>
      <div class="touch-right"><div class="touch-modifiers"><button data-hold="spinLeft" aria-label="Spin left">↶</button><button data-hold="grind">GRIND</button><button data-hold="manual">MANUAL</button><button data-hold="spinRight" aria-label="Spin right">↷</button></div><div id="flick-pad"><span>↑ OLLIE</span><strong>FLICK</strong><small>← FLIP →</small></div></div>
    </div>
  </section>
  <div id="toast" class="toast" role="status" aria-live="polite"></div>
  <div id="bail-overlay" class="bail-overlay hidden"><span>SHAKE IT OFF</span><strong>Back on board.</strong><p id="bail-reason"></p></div>

  <aside id="builder" class="builder hidden" aria-label="Park editor">
    <div class="panel-heading"><div><span class="eyebrow">MAKE IT YOURS</span><h2>Build your line.</h2></div><button id="close-builder" class="close-button" aria-label="Close editor">×</button></div>
    <p>Place an obstacle ahead of your board. Green means you're clear to drop it.</p>
    <label for="object-type">Obstacle</label><select id="object-type"><option value="rail">Flat rail</option><option value="ramp">Funbox ramp</option><option value="ledge">Manual pad</option></select>
    <label for="object-distance">Distance <output id="distance-output">5 m</output></label><input id="object-distance" type="range" min="2" max="12" value="5" step=".5">
    <label for="object-offset">Side to side</label><input id="object-offset" type="range" min="-8" max="8" value="0" step=".5">
    <div class="rotate-row"><button id="rotate-object">Rotate 45°</button><span id="rotation-label">0°</span></div>
    <button id="place-object" class="primary">Drop obstacle</button>
    <button id="undo-object" class="secondary">Undo last placement</button>
    <div class="builder-footer"><span id="object-count">0 / 24 placed</span><span>Saved on this device</span></div>
  </aside>

  <dialog id="menu-dialog" aria-labelledby="menu-title">
    <div class="dialog-header"><div><span class="eyebrow">SK8.IO / SESSION TOOLS</span><h2 id="menu-title">Your session.</h2></div><button id="close-menu" class="close-button" aria-label="Close menu">×</button></div>
    <div class="tabs" role="tablist"><button id="tab-session" role="tab" aria-selected="true" aria-controls="panel-session" data-tab="session">Session</button><button id="tab-garage" role="tab" aria-selected="false" aria-controls="panel-garage" data-tab="garage">Board setup</button><button id="tab-controls" role="tab" aria-selected="false" aria-controls="panel-controls" data-tab="controls">Controls</button></div>
    <div id="panel-session" class="tab-panel" role="tabpanel" aria-labelledby="tab-session">
      <h3>A new line is one push away.</h3><p>Keep a line alive by landing another trick within three seconds. Flips, spins, manuals, and grinds build your multiplier.</p>
      <label for="spawn-select">Reset spot</label><select id="spawn-select"><option value="plaza">The plaza · rails & ledges</option><option value="bowl">The bowl · flow & transitions</option><option value="street">Street line · ramps & gaps</option></select>
      <div class="setting-row"><label for="lighting">Light</label><select id="lighting"><option value="day">Coastal afternoon</option><option value="sunset">Golden hour</option></select></div>
      <div class="setting-row"><label for="quality">Graphics</label><select id="quality"><option value="high">High · shadows</option><option value="low">Performance</option></select></div>
      <div class="setting-row"><label for="touch-setting">Touch controls</label><select id="touch-setting"><option value="auto">Automatic</option><option value="on">Always show</option><option value="off">Hide</option></select></div>
      <button id="resume-button" class="primary">Back to skating</button><button id="change-spot" class="secondary">Reset at selected spot</button>
    </div>
    <div id="panel-garage" class="tab-panel hidden" role="tabpanel" aria-labelledby="tab-garage">
      <div class="deck-preview" id="deck-preview"><span>sk8.io</span><small>8.25″ / MAPLE / TWIN KICK</small></div>
      <h3>Your everyday setup.</h3><p>A shaped maple deck, metal trucks, and 54 mm wheels. Your setup saves automatically on this device.</p>
      <label>Deck color</label><div class="swatches" id="deck-swatches">${[['#c7f35e', 'Acid'], ['#ee805d', 'Clay'], ['#70b6c8', 'Pool'], ['#c4abdf', 'Lilac'], ['#ece8da', 'Chalk'], ['#242c2b', 'Carbon']].map(([c, n]) => `<button data-deck="${c}" style="--swatch:${c}" title="${n}" aria-label="${n} deck" aria-pressed="false"></button>`).join('')}</div>
      <label>Wheels</label><div class="wheel-options">${[['#efe6ce', 'Natural'], ['#292e2b', 'Black'], ['#ed8655', 'Orange']].map(([c, n]) => `<button data-wheels="${c}" aria-pressed="false"><i style="background:${c}"></i>${n}</button>`).join('')}</div>
      <label for="grip-setting">Truck response <output id="grip-output">Balanced</output></label><input id="grip-setting" type="range" min=".3" max="1" step=".05" value=".7"><div class="range-labels"><span>Loose / drifty</span><span>Tight / planted</span></div>
    </div>
    <div id="panel-controls" class="tab-panel hidden" role="tabpanel" aria-labelledby="tab-controls">
      <h3>Feel it out.</h3><p>Build speed, hold your pop, then release. Let flips finish before you land. Approach rails along their length and hold grind.</p>
      <table class="controls-table"><thead><tr><th>Move</th><th>Keyboard</th><th>Controller</th></tr></thead><tbody>
      <tr><td>Push / steer</td><td>W / A D</td><td>A / left stick</td></tr><tr><td>Brake</td><td>S</td><td>D-pad down</td></tr><tr><td>Charge & ollie</td><td>Hold / release Space</td><td>Hold / release RT</td></tr><tr><td>Kickflip / heelflip</td><td>J / K in air</td><td>X / B in air</td></tr><tr><td>Pop shuvit</td><td>U in air</td><td>Y in air</td></tr><tr><td>Spin left / right</td><td>Q / E in air</td><td>LB / RB</td></tr><tr><td>Grind / manual</td><td>Hold G / Shift</td><td>LT / left stick click</td></tr><tr><td>Reset / pause</td><td>R / Esc</td><td>View / Menu</td></tr><tr><td>Camera</td><td>C</td><td>Right stick</td></tr>
      </tbody></table><div class="touch-help"><strong>On a touchscreen</strong><p>Hold PUSH and steer with the left pad. Hold the FLICK pad to charge, then release for an ollie. Swipe left or right for a flip, or down for a shuvit. Spin, grind, and manual buttons can be held together.</p></div><div id="pad-note" class="controller-note">Connect a standard Xbox or PlayStation controller, then press a button to pair it with the game. Labels above use Xbox names.</div>
    </div>
  </dialog>
  <div id="fatal" class="fatal hidden" role="alert"><h2>Your park couldn't load.</h2><p id="fatal-message"></p><button onclick="location.reload()" class="primary">Try again</button></div>
`;

const physics = new SkatePhysics(obstacles); physics.grip = settings.grip;
let world;
try { world = new ParkWorld($('#game'), obstacles, settings); }
catch (error) {
  $('#fatal').classList.remove('hidden'); $('#fatal-message').textContent = 'This game needs WebGL 2. Enable graphics acceleration in your browser, or try a current version of Chrome, Edge, Firefox, or Safari.';
  throw error;
}
const audio = new SkateAudio(); audio.enabled = settings.sound;
const input = new Input(action => {
  if (action === 'start') { if (!started && !$('#menu-dialog').open) start(); else if ($('#menu-dialog').open) closeMenu(); return; }
  if (action === 'blur' && started && !paused) { openMenu('session'); return; }
  if (action === 'pause') { if ($('#menu-dialog').open) closeMenu(); else if (started) openMenu('session'); return; }
  if (!started || $('#menu-dialog').open) return;
  if (action === 'reset') reset();
  if (action === 'camera') { world.cameraMode = 1 - world.cameraMode; world.cameraYaw = 0; notify(world.cameraMode ? 'Low follow camera' : 'Follow camera'); }
  if (action === 'build') toggleBuilder();
});
function notify(message) { $('#toast').textContent = message; $('#toast').classList.add('visible'); messageTime = 3; }
function start() {
  started = true; playing = true; paused = false; physics.reset(selectedSpawn); input.clear(); input.active = true;
  $('#welcome').classList.add('hidden'); $('#welcome-footer').classList.add('hidden'); $('#play-hud').classList.remove('hidden');
  $('#zone-name').textContent = SPAWNS[selectedSpawn].name; $('#spawn-select').value = selectedSpawn;
  audio.start().catch(() => {}); notify('Hold push to get rolling. Hold & release pop to ollie.');
}
function reset() {
  physics.bank(); physics.reset(selectedSpawn); input.clear(); world.cameraYaw = 0;
  $('#bail-overlay').classList.add('hidden'); if (building) updateGhost(); notify('Fresh line. Make it count.');
}
function openMenu(tab) {
  if (building) toggleBuilder(false);
  paused = true; input.active = false; input.clear();
  showTab(tab); if (!$('#menu-dialog').open) $('#menu-dialog').showModal();
}
function closeMenu() { $('#menu-dialog').close(); }
$('#menu-dialog').addEventListener('close', () => { paused = false; input.clear(); input.active = started; last = performance.now(); accumulator = 0; });
function showTab(name) {
  for (const b of document.querySelectorAll('[data-tab]')) { b.setAttribute('aria-selected', String(b.dataset.tab === name)); b.tabIndex = b.dataset.tab === name ? 0 : -1; }
  for (const p of document.querySelectorAll('.tab-panel')) p.classList.toggle('hidden', p.id !== `panel-${name}`);
  $('#menu-title').textContent = { session: 'Your session.', garage: 'Your board.', controls: 'Find your feet.' }[name];
}
$('.tabs').addEventListener('keydown', e => {
  if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  const tabs = [...document.querySelectorAll('[data-tab]')], i = tabs.indexOf(document.activeElement);
  const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : 2)) % 3]; next.click(); next.focus(); e.preventDefault();
});
for (const b of document.querySelectorAll('[data-tab]')) b.addEventListener('click', () => showTab(b.dataset.tab));
for (const b of document.querySelectorAll('[data-spawn]')) b.addEventListener('click', () => {
  selectedSpawn = b.dataset.spawn;
  document.querySelectorAll('[data-spawn]').forEach(el => { el.classList.toggle('active', el === b); el.setAttribute('aria-pressed', String(el === b)); });
  physics.reset(selectedSpawn); $('#zone-name').textContent = SPAWNS[selectedSpawn].name;
});
$('#start-button').onclick = start;
$('.wordmark').onclick = e => { e.preventDefault(); if (started) openMenu('session'); };
$('#help-button').onclick = $('#welcome-help').onclick = () => openMenu('controls');
$('#garage-button').onclick = $('#welcome-garage').onclick = () => openMenu('garage');
$('#pause-button').onclick = () => openMenu('session');
$('#close-menu').onclick = closeMenu;
$('#resume-button').onclick = () => { closeMenu(); if (!started) start(); };
$('#change-spot').onclick = () => { selectedSpawn = $('#spawn-select').value; closeMenu(); if (!started) start(); else reset(); $('#zone-name').textContent = SPAWNS[selectedSpawn].name; };
$('#reset-button').onclick = reset;
$('#camera-button').onclick = () => { world.cameraMode = 1 - world.cameraMode; world.cameraYaw = 0; notify(world.cameraMode ? 'Low follow camera' : 'Follow camera'); };
$('#fullscreen-button').onclick = async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); else notify('Use Add to Home Screen for full-screen play on this device.'); } catch { notify('Fullscreen is unavailable in this browser.'); }
};
function syncSettings() {
  physics.grip = settings.grip; world.applySettings(settings); audio.enabled = settings.sound;
  $('#sound-button').classList.toggle('muted', !settings.sound); $('#sound-button').setAttribute('aria-pressed', String(settings.sound));
  const touch = settings.touch === 'on' || (settings.touch !== 'off' && (matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 || innerWidth <= 900));
  document.body.classList.toggle('touch-mode', touch);
  $('#deck-preview').style.setProperty('--deck', settings.deck);
  document.querySelectorAll('[data-deck]').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.deck === settings.deck)));
  document.querySelectorAll('[data-wheels]').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.wheels === settings.wheels)));
  $('#lighting').value = settings.light; $('#quality').value = settings.quality; $('#touch-setting').value = settings.touch;
  $('#grip-setting').value = settings.grip; $('#grip-output').textContent = settings.grip < .5 ? 'Loose' : settings.grip > .85 ? 'Tight' : 'Balanced';
  save('sk8.settings.v1', settings);
}
$('#sound-button').onclick = () => { settings.sound = !settings.sound; syncSettings(); if (settings.sound) audio.start().catch(() => {}); };
for (const b of document.querySelectorAll('[data-deck]')) b.onclick = () => { settings.deck = b.dataset.deck; syncSettings(); };
for (const b of document.querySelectorAll('[data-wheels]')) b.onclick = () => { settings.wheels = b.dataset.wheels; syncSettings(); };
for (const [id, key] of [['lighting', 'light'], ['quality', 'quality'], ['touch-setting', 'touch']]) $(`#${id}`).onchange = e => { settings[key] = e.target.value; syncSettings(); };
$('#grip-setting').oninput = e => { settings.grip = Number(e.target.value); syncSettings(); };
syncSettings();
window.addEventListener('resize', () => {
  if (settings.touch === 'auto') document.body.classList.toggle('touch-mode', matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 || innerWidth <= 900);
});

let objectYaw = 0, candidate = null, placementValid = false;
function toggleBuilder(value = !building) {
  if (!started) return;
  building = value; input.clear(); input.active = !building; $('#builder').classList.toggle('hidden', !building);
  document.body.classList.toggle('building', building);
  if (building) updateGhost(); else { world.setGhost(null); last = performance.now(); accumulator = 0; }
}
function updateGhost() {
  const type = $('#object-type').value, distance = Number($('#object-distance').value), offset = Number($('#object-offset').value);
  candidate = { id: `custom-${Date.now()}`, type, custom: true, x: physics.x + Math.sin(physics.yaw) * distance + Math.cos(physics.yaw) * offset, z: physics.z + Math.cos(physics.yaw) * distance - Math.sin(physics.yaw) * offset, yaw: physics.yaw + objectYaw, height: type === 'ramp' ? .9 : type === 'rail' ? .52 : .4, width: type === 'ramp' ? 3 : type === 'ledge' ? 2 : .4, length: type === 'rail' ? 5 : 4 };
  const radius = Math.hypot(candidate.width, candidate.length) / 2;
  placementValid = custom.length < 24 && Math.abs(candidate.x) < 31 - radius && Math.abs(candidate.z) < 29 - radius && Math.hypot(candidate.x + 18, candidate.z - 13) > 10.5 + radius && baseHeight(candidate.x, candidate.z) === 0 && obstacles.every(o => Math.hypot(o.x - candidate.x, o.z - candidate.z) > radius + Math.hypot(o.width || .4, o.length) / 2 + .2);
  $('#distance-output').textContent = `${distance} m`; $('#rotation-label').textContent = `${Math.round(objectYaw * 180 / Math.PI) % 360}°`;
  $('#object-count').textContent = `${custom.length} / 24 placed`; $('#undo-object').disabled = !custom.length;
  $('#place-object').disabled = !placementValid; $('#place-object').textContent = custom.length >= 24 ? 'Park is full · undo to make space' : placementValid ? 'Drop obstacle' : 'Move to a clear, flat space';
  world.setGhost(candidate, placementValid);
}
$('#build-button').onclick = () => toggleBuilder(); $('#close-builder').onclick = () => toggleBuilder(false);
for (const id of ['object-type', 'object-distance', 'object-offset']) $(`#${id}`).oninput = updateGhost;
$('#rotate-object').onclick = () => { objectYaw += Math.PI / 4; updateGhost(); };
$('#place-object').onclick = () => {
  if (!placementValid) return;
  const placed = { ...candidate }; custom.push(placed); obstacles.push(placed); world.addObstacle(placed); save('sk8.obstacles.v1', custom); updateGhost(); notify('Obstacle dropped. Your park is saved.');
};
$('#undo-object').onclick = () => {
  const item = custom.pop(); if (!item) return;
  const index = obstacles.findIndex(o => o.id === item.id); if (index >= 0) obstacles.splice(index, 1);
  world.removeObstacle(item.id); save('sk8.obstacles.v1', custom); updateGhost(); notify('Last obstacle removed.');
};

function updateHud() {
  $('#total-score').textContent = physics.total.toLocaleString(); $('#speed').textContent = Math.round(physics.speed * 3.6);
  $('#ride-state').textContent = physics.rail ? 'GRINDING' : physics.manualTime ? 'MANUAL' : physics.charge ? 'CHARGING' : !physics.grounded ? 'AIRBORNE' : physics.speed > .4 ? 'ROLLING' : 'READY';
  $('#charge-fill').style.width = `${physics.charge * 100}%`; $('#line-score').textContent = physics.combo.toLocaleString();
  $('#multiplier').textContent = `×${Math.max(1, physics.multiplier - 1)}`; $('#line-timer').style.width = `${physics.comboTimer / 3 * 100}%`;
  $('#line-panel').classList.toggle('visible', physics.combo > 0 || trickTime > 0 || !!physics.rail || physics.manualTime > .4);
  if (physics.rail) $('#trick-name').textContent = '50–50 GRIND';
  else if (physics.manualTime > .4) $('#trick-name').textContent = 'MANUAL';
  $('#distance').textContent = physics.distance < 1000 ? `${Math.floor(physics.distance)} m` : `${(physics.distance / 1000).toFixed(2)} km`;
  $('#landed').textContent = physics.landed; $('#grinds').textContent = physics.grinds;
  $('#session-time').textContent = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(Math.floor(elapsed % 60)).padStart(2, '0')}`;
  $('#controller-status').textContent = input.controller ? 'CONTROLLER CONNECTED' : document.body.classList.contains('touch-mode') ? 'TOUCH CONTROLS' : 'KEYBOARD + MOUSE';
  $('#pad-note').textContent = input.controller ? `Connected: ${input.controller}` : !navigator.getGamepads ? 'Controller input needs a secure connection (HTTPS). You can also use touch controls.' : 'Connect a standard Xbox or PlayStation controller, then press a button. Labels above use Xbox names.';
}
function handleEvents() {
  for (const event of physics.events.splice(0)) {
    if (['pop', 'land', 'bail'].includes(event.type)) audio.hit(event.type);
    if (event.type === 'score' || event.type === 'trick') { $('#trick-name').textContent = event.name; trickTime = 2.5; }
    if (event.type === 'bank') {
      best = Math.max(best, event.points); save('sk8.best.v1', best); $('#best-score').textContent = best.toLocaleString(); notify(`Line banked · +${event.points.toLocaleString()}`);
    }
    if (event.type === 'bail') { $('#bail-overlay').classList.remove('hidden'); $('#bail-reason').textContent = event.reason; }
    if (event.type === 'respawn') $('#bail-overlay').classList.add('hidden');
  }
}
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, .05); last = now; input.pollPad();
  const running = playing && !paused && !building && !document.hidden;
  if (running) {
    elapsed += dt; accumulator += dt;
    if (accumulator >= 1 / 120) {
      let firstInput = input.read();
      while (accumulator >= 1 / 120) { physics.step(1 / 120, firstInput); firstInput = { ...firstInput, kickflip: false, heelflip: false, shuvit: false }; accumulator -= 1 / 120; }
    }
    handleEvents();
  } else accumulator = 0;
  if (messageTime > 0) { messageTime -= dt; if (messageTime <= 0) $('#toast').classList.remove('visible'); }
  trickTime = Math.max(0, trickTime - dt); hudTimer += dt;
  if (hudTimer > .08) { updateHud(); hudTimer = 0; }
  audio.update(physics, running); world.render(physics, dt, started, input.orbit, building);
}
world.renderer.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); openMenu('session'); notify('Graphics paused. Reload the page to restore the park.'); });
window.addEventListener('pagehide', () => { physics.bank(); handleEvents(); });
// Read-only telemetry for repeatable browser checks and future feel tuning.
window.sk8 = Object.freeze({ snapshot: () => ({ started, paused, building, x: physics.x, y: physics.y, z: physics.z, speed: physics.speed, grounded: physics.grounded, charge: physics.charge, total: physics.total, combo: physics.combo, landed: physics.landed, grinds: physics.grinds, bailTime: physics.bailTime, customObstacles: custom.length, settings: { ...settings }, controller: input.controller, renderer: { ...world.renderer.info.render }, elapsed }) });
updateHud(); requestAnimationFrame(frame);
