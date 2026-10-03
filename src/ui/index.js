// SK8.IO — DOM user interface (menus, customize, controls, settings, HUD, dropper bar).
// See CONTRACTS.md §4. Pure DOM + CSS, no dependencies.
import './style.css';
import { h, svg, clamp } from './dom.js';
import { ICONS } from './icons.js';
import { pickerRow, swatchRow, sliderRow, toggleRow, segmentRow } from './rows.js';
import { buildControlsContent } from './controls.js';
import {
  SKIN_TONES, HAIR_STYLES, HAIR_COLORS, FACIAL_HAIR, HEADWEAR, EYEWEAR, TOPS, TOP_GRAPHICS, BOTTOMS, SHOES,
  CLOTH_COLORS, DECK_GRAPHICS, GRIP_STYLES, TRUCK_FINISHES, WHEEL_COLORS, WHEEL_SIZES,
  DEFAULT_APPEARANCE, DEFAULT_BOARD, randomAppearance, randomBoard,
} from '../core/customization.js';

export const DEFAULT_SETTINGS = {
  mouseSensitivity: 1,
  invertFlickY: false,
  stance: 'regular',
  cameraFov: 75,
  cameraDistance: 1,
  masterVolume: 0.8,
  sfxVolume: 1,
  musicVolume: 0.35,
  quality: 'high',
  showTrickNames: true,
  gestureGuide: true,
};

const SCREENS = ['title', 'playing', 'paused', 'customize', 'controls', 'settings', 'dropper'];
const MENUS = new Set(['title', 'paused', 'customize', 'controls', 'settings']);
const SUBS = new Set(['customize', 'controls', 'settings']);

let fontsInjected = false;
function injectFonts() {
  if (fontsInjected || typeof document === 'undefined') return;
  fontsInjected = true;
  if (document.querySelector('link[data-sk8-fonts]')) return;
  const pc1 = h('link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' });
  const pc2 = h('link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' });
  const link = h('link', {
    rel: 'stylesheet',
    'data-sk8-fonts': '',
    href: 'https://fonts.googleapis.com/css2?family=Anton&family=Oswald:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap',
  });
  document.head.append(pc1, pc2, link);
}

function wordmark(size = '') {
  return h('div', { class: `wordmark ${size}`, 'aria-label': 'SK8.IO', role: 'img' },
    h('span', { class: 'wm-sk8', text: 'SK8' }),
    h('span', { class: 'wm-dot' }, h('i')),
    h('span', { class: 'wm-io', text: 'io' }));
}

export function createUI({ root, appearance, board, settings, previewHooks, audio, keyboard = true } = {}) {
  injectFonts();
  if (!root) {
    root = document.getElementById('ui');
    if (!root) { root = h('div', { id: 'ui' }); document.body.appendChild(root); }
  }
  root.classList.add('sk8ui');
  root.textContent = '';

  // ---------------------------------------------------------------- state
  const listeners = {};
  const emit = (ev, ...args) => {
    for (const cb of listeners[ev] || []) {
      try { cb(...args); } catch (e) { console.error('[ui] listener error', ev, e); }
    }
  };
  let lastHover = 0;
  const sound = (name) => {
    if (name === 'uiHover') {
      const now = performance.now();
      if (now - lastHover < 35) return;
      lastHover = now;
    }
    emit('sound', name);
    try { audio?.play?.(name); } catch { /* audio must never break UI */ }
  };

  let app = { ...DEFAULT_APPEARANCE, ...(appearance || {}) };
  let brd = { ...DEFAULT_BOARD, ...(board || {}) };
  let cfg = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  let spots = [];
  let current = null;
  let returnTo = 'title';
  let shownAt = 0;
  let inputMode = 'kbm';
  let gamepadConnected = false;

  const layerScreens = h('div', { class: 'screens' });
  const grain = h('div', { class: 'grain' });
  const toastLayer = h('div', { class: 'toasts' });
  root.append(layerScreens, grain, toastLayer);

  // ---------------------------------------------------------------- navigation
  let focusEl = null;
  let scope = null; // element whose [data-nav] descendants are navigable

  const navItems = () =>
    scope ? [...scope.querySelectorAll('[data-nav]')].filter((el) => el.offsetParent !== null && !el.disabled) : [];

  function setFocus(el, { silent = false, scroll = true } = {}) {
    if (el === focusEl) return;
    focusEl?.classList.remove('focus');
    focusEl = el;
    if (!el) return;
    el.classList.add('focus');
    if (scroll) el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    el._onFocus?.();
    if (!silent) sound('uiHover');
  }

  function focusDefault() {
    const items = navItems();
    const def = items.find((e) => e.hasAttribute('data-default')) || items[0] || null;
    focusEl?.classList.remove('focus');
    focusEl = null;
    setFocus(def, { silent: true });
  }

  function setScope(el, focus = true) {
    scope = el;
    if (focus) focusDefault();
  }

  function spatial(dir) {
    const items = navItems();
    if (!items.length) return null;
    if (!focusEl || !items.includes(focusEl)) return items[0];
    const r0 = focusEl.getBoundingClientRect();
    const c0x = (r0.left + r0.right) / 2, c0y = (r0.top + r0.bottom) / 2;
    let best = null, bestScore = Infinity;
    const vertical = dir === 'up' || dir === 'down';
    for (const el of items) {
      if (el === focusEl) continue;
      const r = el.getBoundingClientRect();
      const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
      let primary, secondary;
      if (vertical) {
        const dy = dir === 'down' ? cy - c0y : c0y - cy;
        if (dy <= 2) continue;
        primary = dir === 'down' ? Math.max(0, r.top - r0.bottom) : Math.max(0, r0.top - r.bottom);
        secondary = Math.max(0, Math.max(r.left, r0.left) - Math.min(r.right, r0.right));
        primary += dy * 0.02;
        secondary += Math.abs(cx - c0x) * 0.02;
      } else {
        const dx = dir === 'right' ? cx - c0x : c0x - cx;
        if (dx <= 2) continue;
        primary = dir === 'right' ? Math.max(0, r.left - r0.right) : Math.max(0, r0.left - r.right);
        secondary = Math.max(0, Math.max(r.top, r0.top) - Math.min(r.bottom, r0.bottom));
        primary += dx * 0.02;
        secondary += Math.abs(cy - c0y) * 0.02;
      }
      const score = primary + secondary * 3;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (!best && vertical && scope?.hasAttribute('data-wrap')) {
      // wrap around in simple vertical lists
      best = dir === 'down' ? items[0] : items[items.length - 1];
      if (best === focusEl) best = null;
    }
    return best;
  }

  function navigate(dir, source = 'pad') {
    if (source === 'pad') setInputMode('pad');
    if (!MENUS.has(current)) return false;
    const scr = screens[current];
    if (dir === 'prevTab' || dir === 'nextTab') { scr.tab?.(dir === 'prevTab' ? -1 : 1); return true; }
    if (dir === 'back') { scr.back?.(); return true; }
    if (dir === 'confirm') {
      if (!focusEl) { focusDefault(); return true; }
      if (focusEl._nav?.activate) { focusEl._nav.activate(); } else { focusEl.click(); }
      return true;
    }
    if (scr.onNav?.(dir)) return true;
    if ((dir === 'left' || dir === 'right') && focusEl?._nav?.adjust) {
      focusEl._nav.adjust(dir === 'left' ? -1 : 1);
      return true;
    }
    const next = spatial(dir);
    if (next) setFocus(next);
    return true;
  }

  // mouse: hover focuses, click activates
  root.addEventListener('pointerover', (e) => {
    const t = e.target.closest?.('[data-nav]');
    if (!t || !scope?.contains(t)) return;
    if (e.pointerType === 'mouse') setInputMode('kbm');
    setFocus(t, { scroll: false });
  });
  root.addEventListener('click', (e) => {
    const t = e.target.closest?.('[data-nav]');
    if (!t || !scope?.contains(t)) return;
    if (t._nav?.activate && !e.target.closest('button.arrow, .sw, .seg, .toggle, .track')) t._nav.activate();
  });

  const KEYMAP = {
    ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right', Enter: 'confirm', NumpadEnter: 'confirm', Space: 'confirm',
    Escape: 'back', Backspace: 'back', KeyQ: 'prevTab', KeyE: 'nextTab',
  };
  function onKey(e) {
    if (!MENUS.has(current)) return;
    if (e.timeStamp && e.timeStamp < shownAt) return; // the key that opened this screen
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const dir = KEYMAP[e.code];
    if (!dir) return;
    if (e.repeat && (dir === 'confirm' || dir === 'back' || dir.endsWith('Tab'))) { e.preventDefault(); return; }
    e.preventDefault();
    setInputMode('kbm');
    navigate(dir, 'kbm');
  }
  if (keyboard) window.addEventListener('keydown', onKey);

  function setInputMode(m) {
    if (m === inputMode) return;
    inputMode = m;
    root.dataset.input = m;
  }
  root.dataset.input = inputMode;

  // ---------------------------------------------------------------- prompts footer
  function prompts(list) {
    // list: [[kbmLabel, padButton, text]]
    return h('footer', { class: 'prompts' },
      list.map(([k, p, t]) =>
        h('span', { class: 'prompt' },
          h('span', { class: 'kc kc-key only-kbm', text: k }),
          h('span', { class: `kc kc-pad pad-${p.toLowerCase()} only-pad`, text: p }),
          h('span', { class: 'prompt-t', text: t }))));
  }

  // ---------------------------------------------------------------- menu item helper
  function menuItem(i, label, sub, onActivate, extra = {}) {
    const el = h('button', { class: 'mi', 'data-nav': '', tabindex: -1, ...extra },
      h('span', { class: 'mi-idx', text: String(i).padStart(2, '0') }),
      h('span', { class: 'mi-body' }, h('span', { class: 'mi-text', text: label }), sub ? h('span', { class: 'mi-sub', text: sub }) : null),
      h('span', { class: 'mi-arrow', html: '<svg viewBox="0 0 16 16"><path d="M3 8h9M8.5 4l4 4-4 4"/></svg>' }));
    el._nav = { activate: () => { sound('uiClick'); onActivate(el); } };
    return el;
  }

  // ================================================================= TITLE
  const titleList = h('nav', { class: 'menu-list title-list', 'data-wrap': '' },
    menuItem(1, 'Skate', 'Drop in — free skate the city', () => { emit('start'); show('playing'); }, { 'data-default': '' }),
    menuItem(2, 'Customize', 'Skater & board setup', () => { emit('customize'); show('customize'); }),
    menuItem(3, 'Controls', 'Keyboard · controller · flick-it', () => { emit('controls'); show('controls'); }),
    menuItem(4, 'Settings', 'Camera · input · audio · video', () => show('settings')));
  const titleEl = h('section', { class: 'screen scr-title' },
    h('div', { class: 'title-vignette' }),
    h('div', { class: 'title-wrap' },
      h('div', { class: 'title-brand' },
        wordmark('wm-xl'),
        h('div', { class: 'wm-tag' }, h('span', { class: 'wm-tag-bar' }), h('span', { text: 'Street skateboarding simulator' }))),
      titleList),
    h('div', { class: 'title-corner' }, h('span', { text: 'v0.1' }), h('span', { class: 'sep' }), h('span', { text: 'Flick-it controls' })),
    prompts([['↑↓', 'LS', 'Navigate'], ['Enter', 'A', 'Select']]));
  const title = {
    el: titleEl,
    enter() { setScope(titleList); },
    back() {},
  };

  // ================================================================= PAUSED
  const spotsList = h('div', { class: 'menu-list spot-list', 'data-wrap': '' });
  const spotsPanel = h('div', { class: 'pause-sub' },
    h('div', { class: 'panel-head' }, h('span', { class: 'panel-kicker', text: 'Teleport' }), h('h3', { text: 'Spots' })),
    spotsList);
  const resetItem = menuItem(7, 'Reset placed objects', 'Clear everything you dropped', (el) => {
    emit('resetPlacedObjects');
    el.classList.add('done');
    el.querySelector('.mi-sub').textContent = 'Cleared ✓';
    setTimeout(() => { el.classList.remove('done'); el.querySelector('.mi-sub').textContent = 'Clear everything you dropped'; }, 1600);
  });
  const pauseList = h('nav', { class: 'menu-list pause-list', 'data-wrap': '' },
    menuItem(1, 'Resume', null, () => resume(), { 'data-default': '' }),
    menuItem(2, 'Teleport', 'Jump to a spot', () => openSpots()),
    menuItem(3, 'Customize', null, () => { emit('customize'); show('customize'); }),
    menuItem(4, 'Object dropper', 'Build your own spot', () => { emit('dropper'); show('dropper'); }),
    menuItem(5, 'Controls', null, () => { emit('controls'); show('controls'); }),
    menuItem(6, 'Settings', null, () => show('settings')),
    resetItem,
    menuItem(8, 'Quit to title', null, () => { emit('quit'); show('title'); }));
  const pausedEl = h('section', { class: 'screen scr-paused' },
    h('div', { class: 'pause-dim' }),
    h('div', { class: 'pause-wrap' },
      h('div', { class: 'pause-main' },
        h('div', { class: 'panel-head' }, wordmark('wm-sm'), h('h2', { class: 'pause-title', text: 'Paused' })),
        pauseList),
      spotsPanel),
    prompts([['↑↓', 'LS', 'Navigate'], ['Enter', 'A', 'Select'], ['Esc', 'B', 'Back']]));
  function renderSpots() {
    spotsList.textContent = '';
    if (!spots.length) {
      spotsList.appendChild(h('div', { class: 'empty', text: 'No spots yet' }));
      return;
    }
    spots.forEach((s, i) => {
      const name = typeof s === 'string' ? s : s.name;
      const it = menuItem(i + 1, name, null, () => { emit('teleport', name); resume(); });
      it.classList.add('mi-sm');
      if (i === 0) it.setAttribute('data-default', '');
      spotsList.appendChild(it);
    });
  }
  function openSpots() {
    renderSpots();
    pausedEl.classList.add('sub-open');
    setScope(spotsList);
  }
  function closeSpots() {
    if (!pausedEl.classList.contains('sub-open')) return false;
    pausedEl.classList.remove('sub-open');
    setScope(pauseList, false);
    setFocus(pauseList.children[1], { silent: true });
    return true;
  }
  function resume() { emit('resume'); show('playing'); }
  const paused = {
    el: pausedEl,
    enter() { pausedEl.classList.remove('sub-open'); setScope(pauseList); },
    back() { sound('uiBack'); if (!closeSpots()) resume(); },
  };

  // ================================================================= CUSTOMIZE
  const setA = (k) => (v) => { app = { ...app, [k]: v }; emit('appearance', { ...app }); };
  const setB = (k) => (v) => { brd = { ...brd, [k]: v }; emit('board', { ...brd }); };
  const getA = (k) => () => app[k];
  const getB = (k) => () => brd[k];
  const pa = (label, key, options) => pickerRow({ label, options, get: getA(key), set: setA(key), sound });
  const sa = (label, key, colors) => swatchRow({ label, colors, get: getA(key), set: setA(key), sound });
  const pb = (label, key, options) => pickerRow({ label, options, get: getB(key), set: setB(key), sound });
  const sb = (label, key, colors) => swatchRow({ label, colors, get: getB(key), set: setB(key), sound });

  const czRows = {
    skater: [
      [
        sa('Skin tone', 'skin', SKIN_TONES),
        sliderRow({ label: 'Build', min: 0, max: 1, step: 0.05, get: getA('build'), set: setA('build'), ends: ['Skinny', 'Stocky'], format: (v) => Math.round(v * 100) + '%', sound }),
        sliderRow({ label: 'Height', min: 0, max: 1, step: 0.05, get: getA('height'), set: setA('height'), ends: ['1.65', '1.92'], format: (v) => (1.65 + v * 0.27).toFixed(2) + ' m', sound }),
        pa('Hair', 'hairStyle', HAIR_STYLES),
        sa('Hair color', 'hairColor', HAIR_COLORS),
        pa('Facial hair', 'facialHair', FACIAL_HAIR),
        pa('Headwear', 'headwear', HEADWEAR),
        sa('Headwear color', 'headwearColor', CLOTH_COLORS),
        pa('Eyewear', 'eyewear', EYEWEAR),
      ],
      [
        pa('Top', 'top', TOPS),
        sa('Top color', 'topColor', CLOTH_COLORS),
        pa('Graphic', 'topGraphic', TOP_GRAPHICS),
        sa('Graphic color', 'topGraphicColor', CLOTH_COLORS),
        pa('Bottoms', 'bottom', BOTTOMS),
        sa('Bottoms color', 'bottomColor', CLOTH_COLORS),
        pa('Shoes', 'shoes', SHOES),
        sa('Shoe color', 'shoeColor', CLOTH_COLORS),
        sa('Sole color', 'shoeSoleColor', CLOTH_COLORS),
      ],
    ],
    board: [
      [
        pb('Deck graphic', 'deckGraphic', DECK_GRAPHICS),
        sb('Deck color', 'deckColor', CLOTH_COLORS),
        sb('Accent color', 'deckAccent', CLOTH_COLORS),
        pb('Griptape', 'grip', GRIP_STYLES),
      ],
      [
        pb('Trucks', 'truckFinish', TRUCK_FINISHES),
        sb('Wheel color', 'wheelColor', WHEEL_COLORS),
        pb('Wheel size', 'wheelSize', WHEEL_SIZES.map((s) => ({ id: s, name: s + ' mm' }))),
      ],
    ],
  };
  const czTitles = { skater: [['Body & head', 'Who you are'], ['Outfit', 'What you wear']], board: [['Deck', 'Shape, paint & grip'], ['Hardware', 'Trucks & wheels']] };

  const panelL = h('div', { class: 'cz-scroll' });
  const panelR = h('div', { class: 'cz-scroll' });
  const headL = h('div', { class: 'panel-head' });
  const headR = h('div', { class: 'panel-head' });
  const tabBtns = ['skater', 'board'].map((t) =>
    h('button', { class: 'tab', 'data-nav': '', tabindex: -1, dataset: { tab: t }, text: t === 'skater' ? 'Skater' : 'Board' }));
  tabBtns.forEach((b) => { b._nav = { activate: () => setTab(b.dataset.tab, true) }; });
  const tabInk = h('i', { class: 'tab-ink' });
  const randomBtn = h('button', { class: 'btn btn-ghost', 'data-nav': '', tabindex: -1 }, svg(ICONS.dice, 'btn-ic'), h('span', { text: 'Randomize' }));
  const doneBtn = h('button', { class: 'btn btn-primary', 'data-nav': '', tabindex: -1, 'data-default': '' }, svg(ICONS.check, 'btn-ic'), h('span', { text: 'Done' }));
  randomBtn._nav = { activate: () => randomize() };
  doneBtn._nav = { activate: () => { sound('uiClick'); goBack(); } };
  const dragZone = h('div', { class: 'cz-drag' }, h('div', { class: 'cz-rot-hint' }, svg(ICONS.rotate), h('span', { text: 'Drag to rotate' })));
  const czEl = h('section', { class: 'screen scr-customize' },
    h('div', { class: 'cz-shade' }),
    dragZone,
    h('header', { class: 'cz-top' },
      h('div', { class: 'cz-title' }, h('span', { class: 'panel-kicker', text: 'Customize' })),
      h('div', { class: 'tabs' },
        h('span', { class: 'kc kc-key only-kbm', text: 'Q' }), h('span', { class: 'kc kc-shoulder only-pad', text: 'LB' }),
        h('div', { class: 'tab-row' }, tabInk, tabBtns),
        h('span', { class: 'kc kc-key only-kbm', text: 'E' }), h('span', { class: 'kc kc-shoulder only-pad', text: 'RB' }))),
    h('aside', { class: 'cz-panel cz-left' }, headL, panelL),
    h('aside', { class: 'cz-panel cz-right' }, headR, panelR),
    h('div', { class: 'cz-actions' }, randomBtn, doneBtn),
    prompts([['↑↓', 'LS', 'Option'], ['←→', 'LS', 'Change'], ['Esc', 'B', 'Done']]));

  let czTab = 'skater';
  function setTab(t, user = false) {
    if (user && t !== czTab) sound('uiClick');
    czTab = t;
    tabBtns.forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    tabInk.style.transform = `translateX(${t === 'skater' ? 0 : 100}%)`;
    const [L, R] = czRows[t];
    panelL.replaceChildren(...L);
    panelR.replaceChildren(...R);
    panelL.scrollTop = panelR.scrollTop = 0;
    const [tl, tr] = czTitles[t];
    headL.replaceChildren(h('span', { class: 'panel-kicker', text: tl[1] }), h('h3', { text: tl[0] }));
    headR.replaceChildren(h('span', { class: 'panel-kicker', text: tr[1] }), h('h3', { text: tr[0] }));
    for (const r of [...L, ...R]) r._nav?.refresh?.();
    czEl.dataset.tab = t;
    try { previewHooks?.tab?.(t); } catch (e) { console.error(e); }
    if (current === 'customize') {
      // keep focus on the tab bar if that's where the user is, else first row
      if (focusEl && focusEl.classList.contains('tab')) setFocus(tabBtns[t === 'skater' ? 0 : 1], { silent: true });
      else { focusEl?.classList.remove('focus'); focusEl = null; setFocus(L[0], { silent: true }); }
    }
  }
  function randomize() {
    sound('uiClick');
    if (czTab === 'skater') { app = { ...app, ...randomAppearance() }; emit('appearance', { ...app }); }
    else { brd = { ...brd, ...randomBoard() }; emit('board', { ...brd }); }
    for (const r of [...czRows[czTab][0], ...czRows[czTab][1]]) r._nav?.refresh?.();
    randomBtn.classList.remove('spin'); void randomBtn.offsetWidth; randomBtn.classList.add('spin');
  }
  // drag-to-rotate in the empty middle
  {
    let dragging = false, lastX = 0;
    dragZone.addEventListener('pointerdown', (e) => {
      dragging = true; lastX = e.clientX;
      dragZone.setPointerCapture(e.pointerId);
      dragZone.classList.add('dragging');
    });
    dragZone.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX; lastX = e.clientX;
      if (dx) try { previewHooks?.rotate?.(dx * 0.011); } catch (err) { console.error(err); }
    });
    const end = () => { dragging = false; dragZone.classList.remove('dragging'); };
    dragZone.addEventListener('pointerup', end);
    dragZone.addEventListener('pointercancel', end);
    dragZone.addEventListener('wheel', (e) => { try { previewHooks?.rotate?.(e.deltaY * 0.002); } catch { /* */ } }, { passive: true });
  }
  const customize = {
    el: czEl,
    enter() {
      setTab(czTab);
      setScope(czEl, false);
      focusEl?.classList.remove('focus'); focusEl = null;
      setFocus(czRows[czTab][0][0], { silent: true });
      try { previewHooks?.enter?.(); } catch (e) { console.error(e); }
    },
    exit() { try { previewHooks?.exit?.(); } catch (e) { console.error(e); } },
    back() { sound('uiBack'); goBack(); },
    tab(d) { setTab(czTab === 'skater' ? (d > 0 ? 'board' : 'skater') : (d < 0 ? 'skater' : 'board'), true); },
  };
  setTab('skater');

  // ================================================================= CONTROLS
  const ctlBody = h('div', { class: 'ctl-body' }, buildControlsContent());
  const ctlBack = h('button', { class: 'btn btn-primary', 'data-nav': '', tabindex: -1, 'data-default': '' }, h('span', { text: 'Back' }));
  ctlBack._nav = { activate: () => { sound('uiBack'); goBack(); } };
  const stanceNote = h('span', { class: 'ctl-stance' });
  const ctlEl = h('section', { class: 'screen scr-controls page' },
    h('div', { class: 'page-dim' }),
    h('div', { class: 'page-wrap' },
      h('header', { class: 'page-head' },
        h('div', {}, h('span', { class: 'panel-kicker', text: 'How to skate' }), h('h2', { text: 'Controls' })),
        stanceNote),
      ctlBody,
      h('div', { class: 'page-actions' }, ctlBack)),
    prompts([['↑↓', 'RS', 'Scroll'], ['Esc', 'B', 'Back']]));
  function refreshStanceNote() {
    stanceNote.textContent = cfg.stance === 'goofy'
      ? 'Goofy stance — left / right are mirrored from the regular layout shown'
      : 'Regular stance shown — goofy mirrors left / right';
  }
  const controls = {
    el: ctlEl,
    enter() { refreshStanceNote(); ctlBody.scrollTop = 0; setScope(ctlEl); },
    back() { sound('uiBack'); goBack(); },
    onNav(dir) {
      if (dir === 'up' || dir === 'down') { ctlBody.scrollBy({ top: dir === 'down' ? 160 : -160, behavior: 'smooth' }); return true; }
      return false;
    },
  };

  // ================================================================= SETTINGS
  const setS = (k) => (v) => { cfg = { ...cfg, [k]: v }; applySettings(); emit('settings', { ...cfg }); };
  const getS = (k) => () => cfg[k];
  const pct = (v) => Math.round(v * 100) + '%';
  const settingsGroups = [
    ['Input', [
      sliderRow({ label: 'Mouse sensitivity', min: 0.2, max: 3, step: 0.05, get: getS('mouseSensitivity'), set: setS('mouseSensitivity'), format: (v) => v.toFixed(2) + '×', sound }),
      toggleRow({ label: 'Invert flick Y', get: getS('invertFlickY'), set: setS('invertFlickY'), sound }),
      segmentRow({ label: 'Stance', options: [{ id: 'regular', name: 'Regular' }, { id: 'goofy', name: 'Goofy' }], get: getS('stance'), set: setS('stance'), sound }),
    ]],
    ['Camera', [
      sliderRow({ label: 'Field of view', min: 60, max: 100, step: 1, get: getS('cameraFov'), set: setS('cameraFov'), format: (v) => Math.round(v) + '°', sound }),
      sliderRow({ label: 'Camera distance', min: 0.6, max: 1.6, step: 0.05, get: getS('cameraDistance'), set: setS('cameraDistance'), format: (v) => v.toFixed(2) + '×', sound }),
    ]],
    ['Audio', [
      sliderRow({ label: 'Master volume', min: 0, max: 1, step: 0.05, get: getS('masterVolume'), set: setS('masterVolume'), format: pct, sound }),
      sliderRow({ label: 'Effects volume', min: 0, max: 1, step: 0.05, get: getS('sfxVolume'), set: setS('sfxVolume'), format: pct, sound }),
      sliderRow({ label: 'Music & ambience', min: 0, max: 1, step: 0.05, get: getS('musicVolume'), set: setS('musicVolume'), format: pct, sound }),
    ]],
    ['Video', [
      segmentRow({ label: 'Graphics quality', options: [{ id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' }, { id: 'high', name: 'High' }], get: getS('quality'), set: setS('quality'), sound }),
    ]],
    ['HUD', [
      toggleRow({ label: 'Trick names', get: getS('showTrickNames'), set: setS('showTrickNames'), sound }),
      toggleRow({ label: 'Flick stick guide', get: getS('gestureGuide'), set: setS('gestureGuide'), sound }),
    ]],
  ];
  const allSettingRows = settingsGroups.flatMap(([, rows]) => rows);
  for (const r of allSettingRows) {
    const v = r.querySelector('.row-val');
    if (v) { v.classList.add('set-val'); r.querySelector('.slider').appendChild(v); }
  }
  const resetBtn = h('button', { class: 'btn btn-ghost', 'data-nav': '', tabindex: -1 }, h('span', { text: 'Reset defaults' }));
  resetBtn._nav = { activate: () => { sound('uiClick'); cfg = { ...DEFAULT_SETTINGS }; allSettingRows.forEach((r) => r._nav.refresh()); applySettings(); emit('settings', { ...cfg }); } };
  const setBack = h('button', { class: 'btn btn-primary', 'data-nav': '', tabindex: -1 }, h('span', { text: 'Back' }));
  setBack._nav = { activate: () => { sound('uiBack'); goBack(); } };
  const setBody = h('div', { class: 'set-body' },
    settingsGroups.map(([name, rows]) => h('div', { class: 'set-group' }, h('h4', { text: name }), rows)));
  const setEl = h('section', { class: 'screen scr-settings page' },
    h('div', { class: 'page-dim' }),
    h('div', { class: 'page-wrap narrow' },
      h('header', { class: 'page-head' }, h('div', {}, h('span', { class: 'panel-kicker', text: 'Options' }), h('h2', { text: 'Settings' }))),
      setBody,
      h('div', { class: 'page-actions' }, resetBtn, setBack)),
    prompts([['↑↓', 'LS', 'Option'], ['←→', 'LS', 'Adjust'], ['Esc', 'B', 'Back']]));
  const settingsScr = {
    el: setEl,
    enter() { allSettingRows.forEach((r) => r._nav.refresh()); setBody.scrollTop = 0; setScope(setEl); },
    back() { sound('uiBack'); goBack(); },
  };

  // ================================================================= HUD
  const trickLine = h('div', { class: 'trick-line' });
  const trickSub = h('div', { class: 'trick-sub' });
  const tricksEl = h('div', { class: 'hud-tricks' }, trickLine, trickSub);
  const speedNum = h('span', { class: 'spd-num', text: '0' });
  const padIcon = h('span', { class: 'hud-ic', title: 'Controller connected' }, svg(ICONS.gamepad));
  const markerIcon = h('span', { class: 'hud-ic', title: 'Marker set' }, svg(ICONS.marker));
  const speedEl = h('div', { class: 'hud-speed' },
    h('div', { class: 'hud-icons' }, markerIcon, padIcon),
    h('div', { class: 'spd' }, speedNum, h('span', { class: 'spd-unit', text: 'km/h' })));
  const hintEl = h('div', { class: 'hud-hint' });
  const stickCanvas = h('canvas', { class: 'stick-cv', width: 260, height: 260 });
  const stickEl = h('div', { class: 'hud-stick' }, stickCanvas, h('span', { class: 'stick-label', text: 'Flick' }));
  const dropHint = h('div', { class: 'drop-hint' });
  const dropTrack = h('div', { class: 'drop-track' });
  const dropEl = h('div', { class: 'dropper' },
    h('div', { class: 'drop-head' }, h('span', { class: 'panel-kicker', text: 'Object dropper' }), dropHint),
    h('div', { class: 'drop-view' }, dropTrack));
  const hudEl = h('div', { class: 'hud' }, tricksEl, speedEl, hintEl, stickEl, dropEl);
  layerScreens.append(titleEl, pausedEl, czEl, ctlEl, setEl);
  root.insertBefore(hudEl, layerScreens);

  const screens = { title, paused, customize, controls, settings: settingsScr };

  // trick chain
  let lineItems = [];
  let lineEnded = false;
  let fadeTimer = 0, clearTimer = 0;
  const MAX_ITEMS = 7;
  function clearLine() {
    clearTimeout(fadeTimer); clearTimeout(clearTimer);
    lineItems = [];
    trickLine.textContent = '';
    trickSub.textContent = '';
    tricksEl.classList.remove('fading', 'landed', 'bailed');
    lineEnded = false;
  }
  function renderLine() {
    trickLine.textContent = '';
    const start = Math.max(0, lineItems.length - MAX_ITEMS);
    if (start > 0) trickLine.appendChild(h('span', { class: 'tk-more', text: `+${start} · ` }));
    lineItems.slice(start).forEach((it, i) => {
      if (i > 0) trickLine.appendChild(h('span', { class: 'tk-plus', text: ' + ' }));
      const s = h('span', { class: `tk q-${it.quality}`, text: it.text });
      if (it.fresh) { s.classList.add('pop'); it.fresh = false; }
      trickLine.appendChild(s);
    });
  }
  function trick(text, { quality = 'clean', sub } = {}) {
    if (lineEnded) clearLine();
    clearTimeout(fadeTimer); clearTimeout(clearTimer);
    tricksEl.classList.remove('fading');
    const q = quality === 'bail' || quality === 'sketchy' ? quality : 'clean';
    lineItems.push({ text: q === 'bail' ? 'BAIL' : String(text ?? ''), quality: q, fresh: true });
    renderLine();
    trickSub.textContent = sub || '';
    trickSub.className = `trick-sub q-${q}`;
    if (sub) { trickSub.classList.remove('pop'); void trickSub.offsetWidth; trickSub.classList.add('pop'); }
    if (q === 'bail') { tricksEl.classList.add('bailed'); lineEnd(); }
  }
  function lineEnd() {
    if (!lineItems.length || (lineEnded && fadeTimer)) return;
    lineEnded = true;
    if (!tricksEl.classList.contains('bailed')) tricksEl.classList.add('landed');
    clearTimeout(fadeTimer); clearTimeout(clearTimer);
    fadeTimer = setTimeout(() => {
      tricksEl.classList.add('fading');
      clearTimer = setTimeout(clearLine, 650);
    }, 2500);
  }

  // toasts
  function toast(text) {
    const t = h('div', { class: 'toast' }, h('i', { class: 'toast-dot' }), h('span', { text: String(text) }));
    toastLayer.appendChild(t);
    while (toastLayer.children.length > 3) toastLayer.firstChild.remove();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, 2600);
  }

  // speed / status
  let lastSpeed = -1;
  function setHud({ speedKmh, gamepad, marker } = {}) {
    if (speedKmh != null) {
      const s = Math.max(0, Math.round(speedKmh));
      if (s !== lastSpeed) { speedNum.textContent = s; lastSpeed = s; }
    }
    if (gamepad != null) {
      padIcon.classList.toggle('on', !!gamepad);
      if (gamepad && !gamepadConnected) setInputMode('pad');
      if (!gamepad && gamepadConnected) setInputMode('kbm');
      gamepadConnected = !!gamepad;
    }
    if (marker != null) markerIcon.classList.toggle('on', !!marker);
  }

  function setControlsHint(text) {
    hintEl.textContent = text || '';
    hintEl.classList.toggle('on', !!text);
  }

  // dropper
  let dropItemsRef = null;
  function setDropper({ visible, items, selected = 0, hint } = {}) {
    hudEl.classList.toggle('drop-on', !!visible);
    if (hint != null) dropHint.textContent = hint;
    if (items && items !== dropItemsRef) {
      dropItemsRef = items;
      dropTrack.replaceChildren(...items.map((it, i) =>
        h('div', { class: 'drop-item', dataset: { i } },
          h('span', { class: 'drop-cat', text: it.category || '' }),
          h('span', { class: 'drop-name', text: it.name || it.id }),
          h('span', { class: 'drop-idx', text: String(i + 1).padStart(2, '0') }))));
    }
    const kids = dropTrack.children;
    if (!kids.length) return;
    const sel = clamp(selected | 0, 0, kids.length - 1);
    [...kids].forEach((k, i) => k.classList.toggle('sel', i === sel));
    // center the selected card
    requestAnimationFrame(() => {
      const k = kids[sel];
      if (!k) return;
      const view = dropTrack.parentElement.clientWidth;
      const x = k.offsetLeft + k.offsetWidth / 2 - view / 2;
      dropTrack.style.transform = `translateX(${-x}px)`;
    });
  }

  // flick stick visualizer
  const trail = [];
  let stickState = { x: 0, y: 0, loaded: false };
  const sctx = stickCanvas.getContext('2d');
  function setFlickStick({ x = 0, y = 0, loaded = false } = {}) {
    const now = performance.now();
    stickState = { x: clamp(x, -1.2, 1.2), y: clamp(y, -1.2, 1.2), loaded };
    trail.push({ x: stickState.x, y: stickState.y, t: now });
    while (trail.length && now - trail[0].t > 420) trail.shift();
    drawStick(now);
  }
  function drawStick(now) {
    if (!sctx) return;
    const W = stickCanvas.width, c = W / 2, R = W * 0.36;
    sctx.clearRect(0, 0, W, W);
    // base
    sctx.fillStyle = 'rgba(10,10,12,0.42)';
    sctx.beginPath(); sctx.arc(c, c, W * 0.47, 0, Math.PI * 2); sctx.fill();
    sctx.lineWidth = 3;
    sctx.strokeStyle = stickState.loaded ? 'rgba(255,90,31,0.95)' : 'rgba(243,239,230,0.28)';
    sctx.stroke();
    sctx.lineWidth = 2;
    sctx.strokeStyle = 'rgba(243,239,230,0.12)';
    sctx.beginPath(); sctx.arc(c, c, R, 0, Math.PI * 2); sctx.stroke();
    sctx.beginPath();
    sctx.moveTo(c - W * 0.45, c); sctx.lineTo(c + W * 0.45, c);
    sctx.moveTo(c, c - W * 0.45); sctx.lineTo(c, c + W * 0.45);
    sctx.stroke();
    // load zone (bottom arc)
    sctx.lineWidth = 7;
    sctx.lineCap = 'round';
    sctx.strokeStyle = stickState.loaded ? 'rgba(255,90,31,0.9)' : 'rgba(243,239,230,0.18)';
    sctx.beginPath(); sctx.arc(c, c, W * 0.47 - 9, Math.PI * 0.32, Math.PI * 0.68); sctx.stroke();
    // trail
    if (trail.length > 1) {
      for (let i = 1; i < trail.length; i++) {
        const a = trail[i - 1], b = trail[i];
        const age = (now - b.t) / 420;
        sctx.strokeStyle = `rgba(255,90,31,${(1 - age) * 0.85})`;
        sctx.lineWidth = 10 * (1 - age) + 2;
        sctx.beginPath();
        sctx.moveTo(c + a.x * R, c + a.y * R);
        sctx.lineTo(c + b.x * R, c + b.y * R);
        sctx.stroke();
      }
    }
    // knob
    const kx = c + stickState.x * R, ky = c + stickState.y * R;
    sctx.fillStyle = stickState.loaded ? '#ff5a1f' : 'rgba(243,239,230,0.92)';
    sctx.shadowColor = stickState.loaded ? 'rgba(255,90,31,0.8)' : 'rgba(0,0,0,0.5)';
    sctx.shadowBlur = 16;
    sctx.beginPath(); sctx.arc(kx, ky, W * 0.085, 0, Math.PI * 2); sctx.fill();
    sctx.shadowBlur = 0;
    stickEl.classList.toggle('loaded', !!stickState.loaded);
  }
  drawStick(performance.now());

  function applySettings() {
    hudEl.classList.toggle('no-tricks', !cfg.showTrickNames);
    hudEl.classList.toggle('no-stick', !cfg.gestureGuide);
    refreshStanceNote();
  }
  applySettings();

  // ================================================================= show / back
  function show(name) {
    if (!SCREENS.includes(name) || name === current) return;
    const prev = current;
    if (SUBS.has(name) && !SUBS.has(prev)) returnTo = prev || 'title';
    if (prev && screens[prev]) {
      screens[prev].exit?.();
      screens[prev].el.classList.remove('active');
    }
    current = name;
    shownAt = performance.now();
    root.dataset.screen = name;
    root.classList.toggle('menu-open', MENUS.has(name));
    root.classList.toggle('in-game', name === 'playing' || name === 'dropper');
    hudEl.classList.toggle('dropper-mode', name === 'dropper');
    focusEl?.classList.remove('focus');
    focusEl = null;
    scope = null;
    if (screens[name]) {
      const el = screens[name].el;
      el.classList.remove('active');
      void el.offsetWidth; // restart entry animation
      el.classList.add('active');
      screens[name].enter?.();
    }
    emit('screen', name, prev);
  }

  function goBack() {
    const target = returnTo && returnTo !== current ? returnTo : 'title';
    if (target === 'playing' || target === 'dropper') emit('resume');
    show(target);
  }

  show('title');

  const ui = {
    get screen() { return current; },
    get isMenu() { return MENUS.has(current); },
    get settings() { return { ...cfg }; },
    get appearance() { return { ...app }; },
    get board() { return { ...brd }; },
    show,
    on(ev, cb) { (listeners[ev] ||= []).push(cb); return () => ui.off(ev, cb); },
    off(ev, cb) { const l = listeners[ev]; if (l) { const i = l.indexOf(cb); if (i >= 0) l.splice(i, 1); } },
    navigate: (dir) => navigate(dir, 'pad'),
    trick,
    lineEnd,
    toast,
    setHud,
    setDropper,
    setSpots(list) { spots = Array.isArray(list) ? list.slice() : []; if (pausedEl.classList.contains('sub-open')) renderSpots(); },
    setControlsHint,
    setFlickStick,
    setAppearance(a) { app = { ...DEFAULT_APPEARANCE, ...a }; for (const r of [...czRows.skater[0], ...czRows.skater[1]]) r._nav?.refresh?.(); },
    setBoard(b) { brd = { ...DEFAULT_BOARD, ...b }; for (const r of [...czRows.board[0], ...czRows.board[1]]) r._nav?.refresh?.(); },
    setSettings(s) { cfg = { ...DEFAULT_SETTINGS, ...s }; allSettingRows.forEach((r) => r._nav.refresh()); applySettings(); },
    setAudio(a) { audio = a; },
    destroy() { window.removeEventListener('keydown', onKey); root.textContent = ''; },
  };
  return ui;
}
