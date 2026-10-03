import { clamp } from './physics.js';

export class Input {
  constructor(onAction) {
    this.keys = new Set(); this.touch = {}; this.pulses = {}; this.padPrev = [];
    this.onAction = onAction; this.stick = 0; this.orbit = 0; this.controller = null;
    this.active = false;
    const gameKeys = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyJ', 'KeyK', 'KeyU', 'KeyQ', 'KeyE', 'KeyG', 'ShiftLeft', 'ShiftRight'];
    window.addEventListener('keydown', e => {
      if (e.target instanceof Element && e.target.matches('input, select, textarea')) return;
      if (this.active && gameKeys.includes(e.code)) e.preventDefault();
      if (!e.repeat) {
        if (e.code === 'KeyR') this.onAction('reset');
        if (e.code === 'KeyC') this.onAction('camera');
        if (e.code === 'Escape' && !document.querySelector('dialog[open]')) this.onAction('pause');
        if (e.code === 'KeyB') this.onAction('build');
        if (e.code === 'KeyJ') this.pulses.kickflip = true;
        if (e.code === 'KeyK') this.pulses.heelflip = true;
        if (e.code === 'KeyU') this.pulses.shuvit = true;
      }
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.clear(); this.onAction('blur'); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.clear(); this.onAction('blur'); } });
    this.bindTouch();
  }
  clear() { this.keys.clear(); this.touch = {}; this.pulses = {}; this.stick = 0; }
  bindTouch() {
    for (const el of document.querySelectorAll('[data-hold]')) {
      const key = el.dataset.hold;
      el.addEventListener('pointerdown', e => { e.preventDefault(); el.setPointerCapture(e.pointerId); this.touch[key] = true; el.classList.add('held'); });
      for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(event, () => { this.touch[key] = false; el.classList.remove('held'); });
    }
    const stick = document.querySelector('#steering'), knob = document.querySelector('#stick-knob'); let pointer = null;
    const move = e => {
      if (e.pointerId !== pointer) return;
      const r = stick.getBoundingClientRect(); const dx = clamp((e.clientX - r.left - r.width / 2) / (r.width * .34), -1, 1);
      this.stick = dx; knob.style.transform = `translate(${dx * 32}px,0)`;
    };
    stick.addEventListener('pointerdown', e => { e.preventDefault(); pointer = e.pointerId; stick.setPointerCapture(pointer); move(e); });
    stick.addEventListener('pointermove', move);
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) stick.addEventListener(event, () => { pointer = null; this.stick = 0; knob.style.transform = ''; });
    const flick = document.querySelector('#flick-pad'); let start = null;
    flick.addEventListener('pointerdown', e => { e.preventDefault(); flick.setPointerCapture(e.pointerId); start = { x: e.clientX, y: e.clientY }; this.touch.charge = true; flick.classList.add('held'); });
    flick.addEventListener('pointerup', e => {
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y; this.touch.charge = false;
      if (Math.abs(dx) > 23) this.pulses[dx > 0 ? 'heelflip' : 'kickflip'] = true;
      else if (dy > 28) this.pulses.shuvit = true;
      start = null; flick.classList.remove('held');
    });
    flick.addEventListener('pointercancel', () => { start = null; this.touch.charge = false; flick.classList.remove('held'); });
    for (const el of document.querySelectorAll('[data-pulse]')) el.addEventListener('pointerdown', e => { e.preventDefault(); this.pulses[el.dataset.pulse] = true; });
  }
  pollPad() {
    const pads = navigator.getGamepads?.() || []; const pad = Array.from(pads).find(p => p?.connected);
    this.controller = pad?.id || null; this.padInput = {}; this.orbit = 0;
    if (!pad) { this.padPrev = []; return; }
    const button = i => !!pad.buttons[i]?.pressed;
    const edge = i => button(i) && !this.padPrev[i];
    const dead = v => Math.abs(v || 0) < .16 ? 0 : Math.sign(v) * (Math.abs(v) - .16) / .84;
    if (edge(9)) this.onAction('pause');
    if (edge(8)) this.onAction('reset');
    if (!this.active && edge(0)) this.onAction('start');
    if (this.active) {
      if (edge(2)) this.pulses.kickflip = true;
      if (edge(1)) this.pulses.heelflip = true;
      if (edge(3)) this.pulses.shuvit = true;
      this.padInput = { steer: dead(pad.axes[0]), push: button(0), brake: button(13), charge: button(7), grind: button(6), manual: button(10), spin: (button(5) ? 1 : 0) - (button(4) ? 1 : 0) };
      this.orbit = dead(pad.axes[2]);
      // A down/up flick on the right stick also works as a charged ollie.
      if (pad.axes[3] > .5) this.padInput.charge = true;
    }
    this.padPrev = pad.buttons.map(b => b.pressed);
  }
  read() {
    const has = (...codes) => codes.some(k => this.keys.has(k)); const pad = this.padInput || {};
    const out = {
      steer: clamp((has('KeyD', 'ArrowRight') ? 1 : 0) - (has('KeyA', 'ArrowLeft') ? 1 : 0) + this.stick + (pad.steer || 0), -1, 1),
      push: has('KeyW', 'ArrowUp') || this.touch.push || pad.push,
      brake: has('KeyS', 'ArrowDown') || this.touch.brake || pad.brake,
      charge: has('Space') || this.touch.charge || pad.charge,
      grind: has('KeyG') || this.touch.grind || pad.grind,
      manual: has('ShiftLeft', 'ShiftRight') || this.touch.manual || pad.manual,
      spin: (has('KeyE') || this.touch.spinRight ? 1 : 0) - (has('KeyQ') || this.touch.spinLeft ? 1 : 0) + (pad.spin || 0),
      ...this.pulses,
    };
    this.pulses = {}; return out;
  }
}
