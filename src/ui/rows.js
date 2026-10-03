// Focusable option rows shared by the Customize and Settings screens.
// Every row is ONE nav target: up/down moves between rows, left/right changes the value,
// confirm cycles forward (or toggles). Mouse works directly on the sub-controls.
import { h, clamp } from './dom.js';

function row(cls, label, body, nav) {
  const el = h('div', { class: `row ${cls}`, 'data-nav': '' },
    h('div', { class: 'row-label' }, h('span', { text: label })),
    body);
  el._nav = nav;
  return el;
}

const arrowL = () => h('button', { class: 'arrow arrow-l', tabindex: -1, 'aria-label': 'Previous', html: '<svg viewBox="0 0 10 16"><path d="M8 1.5 2 8l6 6.5"/></svg>' });
const arrowR = () => h('button', { class: 'arrow arrow-r', tabindex: -1, 'aria-label': 'Next', html: '<svg viewBox="0 0 10 16"><path d="M2 1.5 8 8l-6 6.5"/></svg>' });

/** Option picker: ‹ Value › with pip indicator. options: [{id, name, color?}] */
export function pickerRow({ label, options, get, set, sound }) {
  const value = h('div', { class: 'pick-value' });
  const pips = h('div', { class: 'pips' }, options.map(() => h('i')));
  const L = arrowL(), Rr = arrowR();
  const body = h('div', { class: 'pick' }, L, h('div', { class: 'pick-mid' }, value, pips), Rr);
  const idx = () => Math.max(0, options.findIndex((o) => o.id === get()));
  const step = (d) => {
    const i = (idx() + d + options.length) % options.length;
    set(options[i].id);
    refresh();
    value.classList.remove('bump-l', 'bump-r');
    void value.offsetWidth;
    value.classList.add(d < 0 ? 'bump-l' : 'bump-r');
    sound?.('uiClick');
  };
  const refresh = () => {
    const i = idx();
    const o = options[i];
    value.textContent = '';
    if (o.color) value.appendChild(h('span', { class: 'chip', style: { background: o.color } }));
    value.appendChild(document.createTextNode(o.name));
    [...pips.children].forEach((p, j) => p.classList.toggle('on', j === i));
  };
  L.addEventListener('click', (e) => { e.stopPropagation(); step(-1); });
  Rr.addEventListener('click', (e) => { e.stopPropagation(); step(1); });
  const el = row('row-pick', label, body, { adjust: step, activate: () => step(1), refresh });
  refresh();
  return el;
}

/** Colour swatch grid. colors: string[] */
export function swatchRow({ label, colors, get, set, sound }) {
  const grid = h('div', { class: 'swatches' + (colors.length > 10 ? ' two' : '') });
  const sw = colors.map((c) =>
    h('button', {
      class: 'sw', tabindex: -1, style: { '--c': c }, title: c,
      on: { click: (e) => { e.stopPropagation(); set(c); refresh(); sound?.('uiClick'); } },
    }));
  grid.append(...sw);
  const hex = h('span', { class: 'row-meta' });
  const idx = () => colors.findIndex((c) => c.toLowerCase() === String(get()).toLowerCase());
  const step = (d) => {
    const i = idx();
    const n = i < 0 ? 0 : (i + d + colors.length) % colors.length;
    set(colors[n]);
    refresh();
    sound?.('uiClick');
  };
  const refresh = () => {
    const i = idx();
    sw.forEach((s, j) => s.classList.toggle('on', j === i));
    hex.textContent = String(get()).toUpperCase();
  };
  const el = row('row-swatch', label, grid, { adjust: step, activate: () => step(1), refresh });
  el.querySelector('.row-label').appendChild(hex);
  refresh();
  return el;
}

/** Slider with value readout. */
export function sliderRow({ label, min, max, step = 0.05, get, set, format = (v) => v.toFixed(2), ends, sound }) {
  const fill = h('div', { class: 'track-fill' });
  const knob = h('div', { class: 'track-knob' });
  const track = h('div', { class: 'track' }, h('div', { class: 'track-bg' }), fill, knob);
  const val = h('span', { class: 'row-meta row-val' });
  const body = h('div', { class: 'slider' },
    ends ? h('span', { class: 'end', text: ends[0] }) : null,
    track,
    ends ? h('span', { class: 'end', text: ends[1] }) : null);
  const refresh = () => {
    const v = get();
    const t = clamp((v - min) / (max - min), 0, 1);
    fill.style.width = t * 100 + '%';
    knob.style.left = t * 100 + '%';
    val.textContent = format(v);
  };
  const setV = (v) => {
    const q = Math.round((clamp(v, min, max) - min) / step) * step + min;
    const nv = +clamp(q, min, max).toFixed(4);
    if (nv !== get()) { set(nv); refresh(); return true; }
    return false;
  };
  let lastTick = 0;
  const fromPointer = (e) => {
    const r = track.getBoundingClientRect();
    const t = clamp((e.clientX - r.left) / r.width, 0, 1);
    if (setV(min + t * (max - min))) {
      const now = performance.now();
      if (now - lastTick > 45) { sound?.('uiHover'); lastTick = now; }
    }
  };
  track.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    track.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    fromPointer(e);
    const move = (ev) => fromPointer(ev);
    const up = () => {
      el.classList.remove('dragging');
      track.removeEventListener('pointermove', move);
      track.removeEventListener('pointerup', up);
      track.removeEventListener('pointercancel', up);
    };
    track.addEventListener('pointermove', move);
    track.addEventListener('pointerup', up);
    track.addEventListener('pointercancel', up);
  });
  const el = row('row-slider', label, body, {
    adjust: (d) => { if (setV(get() + d * step)) sound?.('uiHover'); },
    activate: () => {},
    refresh,
  });
  el.querySelector('.row-label').appendChild(val);
  refresh();
  return el;
}

/** ON/OFF toggle. */
export function toggleRow({ label, get, set, sound, onText = 'ON', offText = 'OFF' }) {
  const sw = h('div', { class: 'toggle' }, h('span', { class: 'toggle-off', text: offText }), h('span', { class: 'toggle-on', text: onText }), h('i', { class: 'toggle-thumb' }));
  const refresh = () => sw.classList.toggle('on', !!get());
  const flip = (v) => { set(v); refresh(); sound?.('uiClick'); };
  sw.addEventListener('click', (e) => { e.stopPropagation(); flip(!get()); });
  const el = row('row-toggle', label, sw, {
    adjust: (d) => { const v = d > 0; if (v !== !!get()) flip(v); },
    activate: () => flip(!get()),
    refresh,
  });
  refresh();
  return el;
}

/** Segmented select. options: [{id, name}] */
export function segmentRow({ label, options, get, set, sound }) {
  const segs = options.map((o) =>
    h('button', { class: 'seg', tabindex: -1, text: o.name, on: { click: (e) => { e.stopPropagation(); choose(o.id); } } }));
  const body = h('div', { class: 'segments', style: { '--n': options.length } }, h('i', { class: 'seg-thumb' }), segs);
  const thumb = body.firstChild;
  const idx = () => Math.max(0, options.findIndex((o) => o.id === get()));
  const refresh = () => {
    const i = idx();
    segs.forEach((s, j) => s.classList.toggle('on', j === i));
    thumb.style.transform = `translateX(${i * 100}%)`;
  };
  const choose = (id) => { if (id !== get()) { set(id); refresh(); sound?.('uiClick'); } };
  const el = row('row-seg', label, body, {
    adjust: (d) => { const i = clamp(idx() + d, 0, options.length - 1); choose(options[i].id); },
    activate: () => choose(options[(idx() + 1) % options.length].id),
    refresh,
  });
  refresh();
  return el;
}
