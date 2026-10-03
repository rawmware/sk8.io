// Unified input: keyboard + mouse ("flick stick") + standard-mapping gamepads.
// Produces one InputFrame per rendered frame via poll(dt).

const DEADZONE = 0.16;

function radialDeadzone(x, y, dz = DEADZONE) {
  const m = Math.hypot(x, y);
  if (m < dz) return [0, 0];
  const s = Math.min(1, (m - dz) / (1 - dz)) / m;
  return [x * s, y * s];
}

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressedKeys = new Set(); // edge-triggered this frame
    this.mouseButtons = 0;
    this.mousePressed = new Set();
    this.wheel = 0;
    // virtual stick driven by the mouse (x right+, y up+)
    this.mouseStick = { x: 0, y: 0 };
    this.lastMouseMove = 0;
    this.mouseSensitivity = 1;
    this.invertFlickY = false;
    this.mouseEnabled = false; // only while playing (pointer lock or not)
    this.gamepadConnected = false;
    this.lastDevice = 'keyboard';
    this._prevPadButtons = [];
    this._navRepeat = { dir: null, t: 0 };

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressedKeys.add(e.code);
      this.lastDevice = 'keyboard';
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.code) && this.mouseEnabled) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseButtons = 0;
    });
    window.addEventListener('mousedown', (e) => {
      this.mouseButtons |= 1 << e.button;
      this.mousePressed.add(e.button);
      this.lastDevice = 'keyboard';
    });
    window.addEventListener('mouseup', (e) => {
      this.mouseButtons &= ~(1 << e.button);
    });
    window.addEventListener('contextmenu', (e) => {
      if (this.mouseEnabled) e.preventDefault();
    });
    window.addEventListener(
      'wheel',
      (e) => {
        this.wheel += Math.sign(e.deltaY);
      },
      { passive: true },
    );
    window.addEventListener('mousemove', (e) => {
      if (!this.mouseEnabled) return;
      // ~260px of travel = full stick deflection at sensitivity 1
      const k = (this.mouseSensitivity / 260);
      let dx = e.movementX * k;
      let dy = e.movementY * k * (this.invertFlickY ? -1 : 1);
      // ignore absurd jumps (pointer lock re-entry)
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      const s = this.mouseStick;
      s.x += dx;
      s.y -= dy; // mouse pulled toward you = stick down
      const m = Math.hypot(s.x, s.y);
      if (m > 1) {
        s.x /= m;
        s.y /= m;
      }
      this.lastMouseMove = performance.now();
      this.lastDevice = 'keyboard';
    });
    window.addEventListener('gamepadconnected', () => (this.gamepadConnected = true));
    window.addEventListener('gamepaddisconnected', () => {
      this.gamepadConnected = [...(navigator.getGamepads?.() || [])].some(Boolean);
    });
  }

  requestPointerLock() {
    try {
      const p = this.canvas.requestPointerLock?.({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => { try { this.canvas.requestPointerLock?.(); } catch { /* sandboxed */ } });
    } catch {
      /* not allowed (iframe sandbox) – movementX still works without lock */
    }
  }

  exitPointerLock() {
    if (document.pointerLockElement) document.exitPointerLock?.();
  }

  get pointerLocked() {
    return document.pointerLockElement === this.canvas;
  }

  _pad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  poll(dt) {
    const k = this.keys;
    const pad = this._pad();
    this.gamepadConnected = !!pad;
    const f = {
      steer: 0, // +1 = left
      forward: 0, // +1 = up/forward
      push: false,
      brake: false,
      flick: { x: 0, y: 0 },
      flickSource: 'mouse',
      ollie: false,
      manual: false,
      noseManual: false,
      grabToe: false,
      grabHeel: false,
      nose: false, // W / stick up held (for grind & grab modifiers)
      tail: false,
      // edges
      respawn: false,
      setMarker: false,
      toMarker: false,
      dropper: false,
      pause: false,
      customize: false,
      camera: false,
      // dropper / menu helpers
      rotate: 0,
      cycle: 0,
      place: false,
      remove: false,
      nav: null,
      move: { x: 0, y: 0 },
    };

    // ---- keyboard ----
    const left = k.has('KeyA') || k.has('ArrowLeft');
    const right = k.has('KeyD') || k.has('ArrowRight');
    const up = k.has('KeyW') || k.has('ArrowUp');
    const down = k.has('KeyS') || k.has('ArrowDown');
    f.steer = (left ? 1 : 0) - (right ? 1 : 0);
    f.forward = (up ? 1 : 0) - (down ? 1 : 0);
    f.push = up;
    f.brake = down;
    f.nose = up;
    f.tail = down;
    f.ollie = k.has('Space');
    f.manual = k.has('KeyQ') || k.has('ShiftLeft');
    f.noseManual = k.has('KeyE');
    f.grabToe = !!(this.mouseButtons & 1);
    f.grabHeel = !!(this.mouseButtons & 4);
    f.move.x = (right ? 1 : 0) - (left ? 1 : 0);
    f.move.y = f.forward;

    const pk = this.pressedKeys;
    f.respawn = pk.has('KeyR');
    f.setMarker = pk.has('KeyT');
    f.toMarker = pk.has('KeyY');
    f.dropper = pk.has('KeyF');
    f.pause = pk.has('Escape') || pk.has('KeyP');
    f.customize = pk.has('KeyC');
    f.camera = pk.has('KeyV');
    f.rotate = (pk.has('KeyE') ? -1 : 0) + (pk.has('KeyQ') ? 1 : 0);
    f.cycle = (pk.has('BracketRight') || pk.has('Tab') ? 1 : 0) - (pk.has('BracketLeft') ? 1 : 0) + this.wheel;
    for (let d = 1; d <= 9; d++) if (pk.has('Digit' + d)) f.selectIndex = d - 1;
    f.place = this.mousePressed.has(0) || pk.has('Enter');
    f.remove = pk.has('KeyX') || pk.has('Backspace') || pk.has('Delete');
    if (pk.has('ArrowUp')) f.nav = 'up';
    else if (pk.has('ArrowDown')) f.nav = 'down';
    else if (pk.has('ArrowLeft')) f.nav = 'left';
    else if (pk.has('ArrowRight')) f.nav = 'right';
    else if (pk.has('Enter')) f.nav = 'confirm';
    else if (pk.has('Escape') || pk.has('Backspace')) f.nav = 'back';

    // ---- mouse flick stick: springs back to center when the mouse rests ----
    const ms = this.mouseStick;
    const idle = performance.now() - this.lastMouseMove;
    if (idle > 45) {
      const decay = Math.exp(-dt / 0.16);
      ms.x *= decay;
      ms.y *= decay;
    }
    f.flick.x = ms.x;
    f.flick.y = ms.y;

    // ---- gamepad ----
    if (pad) {
      const ax = pad.axes;
      const [lx, ly] = radialDeadzone(ax[0] || 0, ax[1] || 0);
      const [rx, ry] = radialDeadzone(ax[2] || 0, ax[3] || 0, 0.12);
      const b = pad.buttons.map((bt) => (typeof bt === 'object' ? bt.value > 0.5 || bt.pressed : bt > 0.5));
      const prev = this._prevPadButtons;
      const edge = (i) => b[i] && !prev[i];
      const anyPad = Math.abs(lx) + Math.abs(ly) + Math.abs(rx) + Math.abs(ry) > 0.2 || b.some(Boolean);
      if (anyPad) this.lastDevice = 'gamepad';

      if (Math.abs(lx) > Math.abs(f.steer)) f.steer = -lx;
      if (Math.abs(ly) > 0.3) {
        f.forward = -ly;
        f.nose = f.nose || ly < -0.5;
        f.tail = f.tail || ly > 0.5;
      }
      if (Math.hypot(rx, ry) > Math.hypot(f.flick.x, f.flick.y)) {
        f.flick.x = rx;
        f.flick.y = -ry;
        f.flickSource = 'pad';
      }
      f.push = f.push || b[0];
      f.brake = f.brake || b[1];
      f.ollie = f.ollie || b[2];
      f.manual = f.manual || b[4];
      f.noseManual = f.noseManual || b[5];
      f.grabHeel = f.grabHeel || b[6];
      f.grabToe = f.grabToe || b[7];
      f.respawn = f.respawn || edge(3);
      f.setMarker = f.setMarker || edge(12);
      f.toMarker = f.toMarker || edge(13);
      f.dropper = f.dropper || edge(8);
      f.pause = f.pause || edge(9);
      f.camera = f.camera || edge(11);
      f.rotate += (edge(4) ? 1 : 0) - (edge(5) ? 1 : 0);
      f.cycle += (edge(15) ? 1 : 0) - (edge(14) ? 1 : 0);
      f.place = f.place || edge(0);
      f.remove = f.remove || edge(2);
      f.move.x = Math.abs(lx) > Math.abs(f.move.x) ? lx : f.move.x;
      f.move.y = Math.abs(ly) > Math.abs(f.move.y) ? -ly : f.move.y;
      f.padMenuBack = edge(1);

      // menu navigation with auto-repeat on stick/dpad
      let dir = null;
      if (b[12] || ly < -0.6) dir = 'up';
      else if (b[13] || ly > 0.6) dir = 'down';
      else if (b[14] || lx < -0.6) dir = 'left';
      else if (b[15] || lx > 0.6) dir = 'right';
      const nr = this._navRepeat;
      if (dir) {
        if (nr.dir !== dir) {
          nr.dir = dir;
          nr.t = 0.38;
          f.nav = f.nav || dir;
        } else {
          nr.t -= dt;
          if (nr.t <= 0) {
            nr.t = 0.12;
            f.nav = f.nav || dir;
          }
        }
      } else nr.dir = null;
      if (edge(0)) f.nav = 'confirm';
      if (edge(1)) f.nav = 'back';
      if (edge(9)) f.navStart = true;
      this._prevPadButtons = b;
    }

    this.pressedKeys.clear();
    this.mousePressed.clear();
    this.wheel = 0;
    return f;
  }

  rumble(strength = 0.5, ms = 80) {
    const pad = this._pad();
    const act = pad?.vibrationActuator;
    if (act?.playEffect) {
      act.playEffect('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: strength * 0.6 }).catch(() => {});
    }
  }
}
