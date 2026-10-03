import * as THREE from 'three';
import { GRAVITY, BOARD, SURFACE_PROPS, RAIL_KINDS } from '../core/constants.js';
import { FlickRecognizer, trickName } from './flick.js';

// Skateboard physics + trick logic. Runs at a fixed step (see Game). The rider frame is the
// central concept: origin at the wheel contact point, +Y = rider/surface up, +Z = front foot.

const Y = new THREE.Vector3(0, 1, 0);
const G = new THREE.Vector3(0, -GRAVITY, 0);

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _vu = new THREE.Vector3();
const _prev = new THREE.Vector3();
const _disp = new THREE.Vector3();
const _vt = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _hit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: 'concrete' };
const _hit2 = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: 'concrete' };

const GRAB_NAMES = { indy: 'Indy', melon: 'Melon', nose: 'Nose Grab', tail: 'Tail Grab', stalefish: 'Stalefish', mute: 'Mute' };

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export class SkaterController {
  constructor(collision) {
    this.collision = collision;
    this.rails = [];
    this.flick = new FlickRecognizer();
    this.events = [];
    this.stance = 'regular';
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.normal = new THREE.Vector3(0, 1, 0);
    this.landingNormal = new THREE.Vector3(0, 1, 0);
    this.snapshots = [];
    this.marker = null;
    this.time = 0;
    this.board = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), quat: new THREE.Quaternion(), ang: new THREE.Vector3() };
    this.reset(new THREE.Vector3(0, 0, 0), 0);
  }

  get heelSign() {
    return this.stance === 'regular' ? 1 : -1;
  }

  reset(position, yaw, normal = Y) {
    this.mode = 'ground';
    this.pos.copy(position);
    this.vel.set(0, 0, 0);
    this.quat.setFromAxisAngle(Y, yaw);
    if (normal) {
      _q1.setFromUnitVectors(Y, normal);
      this.quat.premultiply(_q1);
      this.normal.copy(normal);
    }
    this.surface = 'concrete';
    this.crouch = 0;
    this.landCompress = 0;
    this.loading = false;
    this.loadNose = false;
    this.spaceHeld = 0;
    this.prevOllie = false;
    this.pushT = -1;
    this.slide = 0;
    this.manual = 0;
    this.manualT = 0;
    this.trick = null;
    this.popT = 10;
    this.popNose = false;
    this.spinRate = 0;
    this.spinTotal = 0;
    this.airTime = 0;
    this.grab = null;
    this.grabs = new Set();
    this.grind = null;
    this.railCooldown = new Map();
    this.boardYawOffset = 0;
    this.wheelSpin = 0;
    this.lean = 0;
    this.bailT = 0;
    this.bailReason = '';
    this.popped = false;
    this.airTrickName = null;
    this.flickAnim = 0;
    this.flickT = 1;
    this.lineTimer = 0;
    this.lineActive = false;
    this.braking = false;
    this.flick.reset();
    this.snapT = 0;
    this.groundT = 0;
    this.lastGroundPos = this.pos.clone();
    this._groundCheck();
  }

  emit(type, data = {}) {
    this.events.push({ type, ...data });
  }

  fwd(target = new THREE.Vector3()) {
    return target.set(0, 0, 1).applyQuaternion(this.quat);
  }
  up(target = new THREE.Vector3()) {
    return target.set(0, 1, 0).applyQuaternion(this.quat);
  }
  side(target = new THREE.Vector3()) {
    return target.set(1, 0, 0).applyQuaternion(this.quat);
  }

  // Rotate the rider so its up axis matches n (amount 0..1).
  alignUp(n, amount = 1) {
    const u = this.up(_vu);
    _q1.setFromUnitVectors(u, n);
    if (amount < 1) _q1.slerp(_q2.identity(), 1 - amount);
    this.quat.premultiply(_q1).normalize();
  }

  // Rotate around an axis (world space)
  rotateAround(axis, angle) {
    _q1.setFromAxisAngle(axis, angle);
    this.quat.premultiply(_q1).normalize();
  }

  get speed() {
    return this.vel.length();
  }

  // Signed speed along the rider's forward axis (negative = rolling fakie)
  get along() {
    return this.vel.dot(this.fwd(_v1));
  }

  _groundCheck() {
    const hit = this.collision.raycast(_v1.copy(this.pos).addScaledVector(Y, 1.5), _v2.set(0, -1, 0), 4, _hit);
    if (hit) {
      this.pos.copy(hit.point);
      this.normal.copy(hit.normal);
      this.surface = hit.surface;
      this.alignUp(hit.normal);
    }
  }

  // ---------------------------------------------------------------------------------------
  step(dt, input) {
    this.time += dt;
    if (this.mode === 'bail') return this._bailStep(dt, input);

    // ---- flick stick ----
    const hs = this.heelSign;
    const u = -input.flick.x * hs;
    const v = input.flick.y;
    const canLoad = this.mode === 'ground' || this.mode === 'grind';
    const lateAllowed = !this.trick && this.airTime > 0.1 && this._heightAboveGround() > 0.5;
    const ev = this.flick.update(dt, u, v, { canLoad, airborne: this.mode === 'air', lateAllowed });
    if (ev) {
      if (ev.type === 'load') {
        this.loading = true;
        this.loadNose = ev.nose;
      } else if (ev.type === 'unload') {
        this.loading = false;
      } else if (ev.type === 'pop') {
        this.loading = false;
        if (ev.late) this._startTrick(ev.flips, ev.shove, false, true);
        else if (canLoad) this._pop(ev);
      }
    }
    // simple ollie button: hold to crouch, release to pop
    if (input.ollie && canLoad) {
      this.spaceHeld += dt;
      this.loading = true;
      this.loadNose = false;
    } else if (!input.ollie && this.prevOllie && this.spaceHeld > 0) {
      this.loading = false;
      if (canLoad) this._pop({ nose: false, flips: 0, shove: 0, power: clamp(0.35 + this.spaceHeld * 2.2, 0.35, 1) });
      this.spaceHeld = 0;
    }
    if (!input.ollie) this.spaceHeld = 0;
    this.prevOllie = input.ollie;
    if (!canLoad && !this.flick.loaded) this.loading = false;

    if (this.mode === 'ground') this._groundStep(dt, input);
    else if (this.mode === 'air') this._airStep(dt, input);
    else if (this.mode === 'grind') this._grindStep(dt, input);

    // ---- timers / smoothing ----
    if (this.trick) {
      this.trick.t += dt;
      if (this.trick.t >= this.trick.dur && !this.trick.caught) {
        this.trick.caught = true;
        this.emit('catch');
      }
    }
    this.popT += dt;
    this.flickT = Math.min(1, this.flickT + dt / 0.28);
    const crouchTarget = this.loading ? 1 : this.mode === 'air' ? 0.15 : 0.12;
    this.crouch = damp(this.crouch, Math.max(crouchTarget, this.landCompress), this.loading ? 16 : 9, dt);
    this.landCompress = damp(this.landCompress, 0, 5, dt);
    this.lean = damp(this.lean, this.mode === 'ground' ? input.steer : this.mode === 'air' ? input.steer * 0.5 : 0, 6, dt);
    for (const [r, t] of this.railCooldown) {
      if (t - dt <= 0) this.railCooldown.delete(r);
      else this.railCooldown.set(r, t - dt);
    }

    // line (combo) timer
    if (this.lineActive && this.mode === 'ground' && !this.manual) {
      this.lineTimer += dt;
      if (this.lineTimer > 1.6) {
        this.lineActive = false;
        this.emit('lineEnd');
      }
    }

    // safe respawn snapshots
    if (this.mode === 'ground') {
      this.snapT += dt;
      if (this.snapT > 0.25) {
        this.snapT = 0;
        this.snapshots.push({ pos: this.pos.clone(), quat: this.quat.clone(), normal: this.normal.clone(), t: this.time });
        if (this.snapshots.length > 20) this.snapshots.shift();
      }
    }
  }

  _trickCallout(text, quality = 'clean') {
    this.lineActive = true;
    this.lineTimer = 0;
    this.emit('trick', { text, quality });
  }

  // ---------------------------------------------------------------------------------------
  _groundStep(dt, input) {
    const n = this.normal;
    const props = SURFACE_PROPS[this.surface] || SURFACE_PROPS.concrete;
    let speed = this.vel.length();
    const fwd = this.fwd(_v1);
    const along = this.vel.dot(fwd);
    const dirSign = along < -0.05 ? -1 : 1;

    // ---- manual ----
    const fm = Math.hypot(input.flick.x, input.flick.y);
    const partial = this.flick.state === 'idle' && fm > 0.28 && fm < 0.66 && input.flickSource === 'pad';
    this.padManualT = partial ? (this.padManualT || 0) + dt : 0;
    const padManual = this.padManualT > 0.15;
    let wantManual = 0;
    if (input.manual || (padManual && input.flick.y < -0.2)) wantManual = 1;
    if (input.noseManual || (padManual && input.flick.y > 0.2)) wantManual = -1;
    if (this.loading || speed < 0.4) wantManual = 0;
    if (wantManual !== this.manual) {
      if (this.manual && this.manualT > 0.4) this._trickCallout(this.manual > 0 ? 'Manual' : 'Nose Manual');
      if (wantManual) this.emit('manualStart');
      this.manual = wantManual;
      this.manualT = 0;
    }
    if (this.manual) this.manualT += dt;

    // ---- steering (carving) ----
    const powersliding = this.slide > 0.3;
    if (!powersliding) {
      const maxRate = speed < 0.6 ? 2.4 : Math.min(2.3, speed / 1.45 + 0.35);
      const rate = input.steer * maxRate * (this.manual ? 0.55 : 1) * (this.loading ? 0.75 : 1);
      this.rotateAround(n, rate * dt);
      this.vel.applyAxisAngle(n, rate * dt);
    }

    // ---- forces ----
    const acc = _v2.copy(G).addScaledVector(n, -G.dot(n)); // gravity along the surface
    speed = this.vel.length();
    if (speed > 0.01) {
      const roll = props.roll * GRAVITY * Math.max(0.2, n.y) + (this.manual ? 0.35 : 0);
      const drag = 0.0045 * speed * speed;
      acc.addScaledVector(this.vel, -(roll + drag) / speed);
    }

    // pushing
    const canPush = !this.loading && !this.manual && this.slide < 0.1 && n.y > 0.8;
    if (this.pushT < 0 && input.push && canPush && speed < 9) {
      this.pushT = 0;
    }
    if (this.pushT >= 0) {
      const prev = this.pushT;
      this.pushT += dt / 0.78;
      if (prev < 0.28 && this.pushT >= 0.28) this.emit('push');
      if (this.pushT > 0.28 && this.pushT < 0.6 && canPush) {
        const pushDir = speed > 0.3 ? _v3.copy(this.vel).normalize() : this.fwd(_v3).multiplyScalar(dirSign);
        const k = Math.max(0, 1 - speed / 7.6);
        acc.addScaledVector(pushDir, 6.2 * k + 0.4);
      }
      if (this.pushT >= 1) this.pushT = input.push && canPush ? 0 : -1;
      if (!canPush && this.pushT < 0.28) this.pushT = -1;
    }

    // braking / powerslide
    this.braking = false;
    const wantSlide = input.brake && speed > 4.2 && !this.manual;
    this.slide = damp(this.slide, wantSlide || (this.slide > 0.5 && input.brake && speed > 1.2) ? 1 : 0, 8, dt);
    if (input.brake && speed > 0.05) {
      if (this.slide > 0.5) acc.addScaledVector(this.vel, -5.2 / speed);
      else if (!wantSlide) {
        this.braking = true;
        acc.addScaledVector(this.vel, -Math.min(3.3, speed / dt) / speed);
      }
    }
    if (this.slide > 0.5 && !this._slideSoundOn) {
      this._slideSoundOn = true;
      this.emit('powerslide');
    } else if (this.slide < 0.3) this._slideSoundOn = false;

    this.vel.addScaledVector(acc, dt);

    // ---- wheel grip: kill lateral velocity ----
    this.fwd(fwd);
    const lat = _v3.copy(this.vel).addScaledVector(fwd, -this.vel.dot(fwd)).addScaledVector(n, -this.vel.dot(n));
    const grip = this.slide > 0.4 ? 1.2 : 18;
    this.vel.addScaledVector(lat, -(1 - Math.exp(-grip * dt)));
    this.vel.addScaledVector(n, -this.vel.dot(n));
    speed = this.vel.length();
    if (speed < 0.05 && !input.push && Math.abs(G.dot(fwd)) < 0.3) this.vel.set(0, 0, 0);

    // keep the rider pointed along travel (wheels roll where they point)
    if (speed > 0.5 && this.slide < 0.3) {
      const a = this.vel.dot(this.fwd(_v1)) < 0 ? -1 : 1;
      _v2.copy(this.vel).multiplyScalar(a / speed);
      const f = this.fwd(_v1);
      const ang = Math.atan2(_v3.crossVectors(f, _v2).dot(n), f.dot(_v2));
      this.rotateAround(n, ang * (1 - Math.exp(-10 * dt)));
    }

    // ---- walls ahead ----
    if (speed > 0.05) {
      const dir = _v1.copy(this.vel).divideScalar(speed);
      const origin = _v2.copy(this.pos).addScaledVector(n, 0.14);
      const len = speed * dt + BOARD.length / 2 + 0.03;
      const hit = this.collision.raycast(origin, dir, len, _hit);
      if (hit && hit.normal.dot(n) < 0.5) {
        const vn = this.vel.dot(hit.normal);
        if (vn < 0) {
          const headOn = -vn / speed;
          if (-vn > 3.6 && headOn > 0.55) return this._bail('Slammed into a wall', hit.normal);
          this.vel.addScaledVector(hit.normal, -vn * 1.25);
          this.vel.multiplyScalar(0.92);
          this.emit('boardHit', { intensity: clamp(-vn / 4, 0.2, 1) });
        }
      }
    }

    // ---- integrate & stick to the surface ----
    this.pos.addScaledVector(this.vel, dt);
    this.wheelSpin += (this.vel.dot(this.fwd(_v1)) * dt) / BOARD.wheelRadius;

    const probeUp = 0.4;
    const snapDown = 0.1 + speed * dt * 0.6;
    const origin = _v1.copy(this.pos).addScaledVector(n, probeUp);
    const dirDown = _v2.copy(n).negate();
    const hit = this.collision.raycast(origin, dirDown, probeUp + snapDown, _hit);
    if (hit && hit.normal.dot(n) > 0.64) {
      const d = hit.distance - probeUp;
      if (d < -0.07) {
        // stepped into something taller than the wheels can roll over
        if (speed > 1.6) return this._bail('Caught a curb', hit.normal);
        this.pos.addScaledVector(this.vel, -dt);
        this.vel.multiplyScalar(-0.2);
        return;
      }
      const newN = hit.normal;
      const smooth = newN.dot(n) > 0.965;
      const spd = this.vel.length();
      this.pos.copy(hit.point);
      this.vel.addScaledVector(newN, -this.vel.dot(newN));
      if (smooth && this.vel.lengthSq() > 1e-8) this.vel.setLength(spd);
      else this.vel.multiplyScalar(0.97);
      this.alignUp(newN);
      this.normal.copy(newN);
      if (hit.surface !== this.surface) {
        const was = this.surface;
        this.surface = hit.surface;
        if ((hit.surface === 'grass' || hit.surface === 'dirt') && was !== hit.surface && spd > 3.5) return this._bail('Hit the grass', newN);
      }
      // overhangs: not enough speed to stay on
      if (newN.y < -0.05 && spd < 3) this._goAir();
      this.groundT += dt;
      this.lastGroundPos.copy(this.pos);
    } else {
      this._goAir();
    }
  }

  _goAir() {
    this.mode = 'air';
    this.airTime = 0;
    this.pushT = -1;
    this.manualEndOnAir();
    this.slide = 0;
    this.landingNormal.copy(this.normal);
    this.predictT = 0;
    // leaving a steep transition: keep the rider oriented to the wall (vert airs)
  }

  manualEndOnAir() {
    if (this.manual) {
      if (this.manualT > 0.4) this._trickCallout(this.manual > 0 ? 'Manual' : 'Nose Manual');
      this.manual = 0;
    }
  }

  _heightAboveGround() {
    const hit = this.collision.raycast(_v1.copy(this.pos).addScaledVector(Y, 0.05), _v2.set(0, -1, 0), 20, _hit2);
    return hit ? hit.distance : 20;
  }

  _pop(ev) {
    const up = this.up(_v1);
    const fwd = this.fwd(_v2);
    const fakie = this.vel.dot(fwd) < -0.2;
    let popSpeed = 2.05 + 1.75 * ev.power;
    if (this.mode === 'grind') {
      popSpeed *= 0.8;
      this._endGrind(false);
    }
    if (this.manual) {
      this.manualEndOnAir();
    }
    if (this.mode === 'ground') this.vel.addScaledVector(up, -this.vel.dot(up));
    const dir = _v3.copy(up);
    if (up.y > 0.3) dir.multiplyScalar(0.82).addScaledVector(Y, 0.18).normalize();
    this.vel.addScaledVector(dir, popSpeed);
    // pre-wound spin
    this.spinRate = this.lean * 4.2;
    this.exitTurn = 0;
    this.spinTotal = 0;
    this.mode = 'air';
    this.airTime = 0;
    this.pushT = -1;
    this.slide = 0;
    this.popT = 0;
    this.popNose = ev.nose;
    this.popped = true;
    this.grabs.clear();
    this.grab = null;
    this.landingNormal.copy(this.normal);
    this.predictT = 0;
    this.airTrickName = trickName(ev.flips, ev.shove, ev.nose, fakie && !ev.nose);
    this.trick = null;
    if (ev.flips || ev.shove) this._startTrick(ev.flips, ev.shove, ev.nose, false);
    this.emit('pop', { power: ev.power });
  }

  _startTrick(flips, shove, nollie, late) {
    const hs = this.heelSign;
    const dur = 0.25 + 0.115 * Math.abs(flips) + 0.075 * Math.abs(shove);
    this.trick = {
      flips,
      shove,
      t: 0,
      dur,
      caught: false,
      flipTotal: -hs * flips * Math.PI * 2 * (nollie ? -1 : 1),
      shoveTotal: -hs * shove * Math.PI * (nollie ? -1 : 1),
      late,
    };
    if (late) this.airTrickName = (this.airTrickName ? this.airTrickName + ' ' : '') + 'Late ' + trickName(flips, shove, false, false);
    if (flips) {
      this.flickAnim = flips > 0 ? hs : -hs; // kickflips kick toward the heel side
      this.flickT = 0;
    } else if (shove) {
      this.flickAnim = 0;
      this.flickT = 0;
    }
    this.emit('flip', { flips, shove });
  }

  // ---------------------------------------------------------------------------------------
  _airStep(dt, input) {
    this.airTime += dt;
    // gravity + drag
    const speed = this.vel.length();
    this.vel.addScaledVector(G, dt);
    if (speed > 0.1) this.vel.addScaledVector(this.vel, -0.0045 * speed * dt);

    // spin control (around the rider's up axis)
    const up = this.up(_v1);
    if (Math.abs(input.steer) > 0.1) this.spinRate = damp(this.spinRate, input.steer * 7.2, 5.5, dt);
    else this.spinRate = damp(this.spinRate, 0, 2.6, dt);
    this.rotateAround(up, this.spinRate * dt);
    this.spinTotal += this.spinRate * dt;
    if (this.exitTurn) {
      const stepA = Math.sign(this.exitTurn) * Math.min(Math.abs(this.exitTurn), 9 * dt);
      this.rotateAround(up, stepA);
      this.exitTurn -= stepA;
    }

    // grabs
    if (this.airTime > 0.1 && (!this.trick || this.trick.caught)) {
      let g = null;
      if (input.grabToe && input.grabHeel) g = 'stalefish';
      else if (input.grabToe || input.grabHeel) {
        if (input.nose) g = 'nose';
        else if (input.tail) g = 'tail';
        else g = input.grabToe ? 'indy' : 'melon';
      }
      if (g && g !== this.grab) {
        this.grabs.add(g);
        this.emit('grab', { name: g });
      }
      this.grab = g;
    } else this.grab = null;

    // auto-level toward the predicted landing surface
    this.predictT -= dt;
    if (this.predictT <= 0) {
      this.predictT = 0.05;
      this._predictLanding();
    }
    const levelRate = this.airTime < 0.15 ? 1.2 : 3.2;
    this.alignUp(this.landingNormal, 1 - Math.exp(-levelRate * dt));

    // integrate with swept collision
    const prev = _prev.copy(this.pos);
    const disp = _disp.copy(this.vel).multiplyScalar(dt);
    const len = disp.length();
    this.pos.add(disp);
    this.wheelSpin += 8 * dt;

    // grinds take priority
    if (this.airTime > 0.06 && this._tryGrind(input)) return;

    if (len > 1e-6) {
      const dir = disp.divideScalar(len);
      const origin = _v1.copy(prev).addScaledVector(Y, 0.02);
      const hit = this.collision.raycast(origin, dir, len + 0.03, _hit);
      if (hit && this.airTime > 0.03) {
        if (this._landable(hit.normal)) return this._land(hit);
        // wall in the air
        const vn = this.vel.dot(hit.normal);
        if (vn < 0) {
          if (-vn > 7.5) return this._bail('Hit a wall', hit.normal);
          this.vel.addScaledVector(hit.normal, -vn * 1.35);
          this.pos.copy(hit.point).addScaledVector(hit.normal, 0.06);
          this.emit('boardHit', { intensity: clamp(-vn / 5, 0.2, 1) });
        }
      }
    }
    // contact probe along the rider's down axis (catches landings while moving parallel to a surface)
    if (this.airTime > 0.08) {
      const u2 = this.up(_v1);
      const o = _v2.copy(this.pos).addScaledVector(u2, 0.3);
      const h = this.collision.raycast(o, _v3.copy(u2).negate(), 0.33, _hit);
      if (h && this._landable(h.normal) && this.vel.dot(h.normal) < 0.6) return this._land(h);
    }
    // safety: fell out of the world
    if (this.pos.y < -30) this.respawn();
  }

  _landable(n) {
    return n.y > 0.25 || n.dot(this.up(_v1)) > 0.7;
  }

  _predictLanding() {
    const p = _v1.copy(this.pos).addScaledVector(Y, 0.05);
    const v = _v2.copy(this.vel);
    const step = 0.06;
    const seg = new THREE.Vector3();
    for (let i = 0; i < 45; i++) {
      seg.copy(v).multiplyScalar(step).addScaledVector(G, 0.5 * step * step);
      const len = seg.length();
      if (len < 1e-5) break;
      const hit = this.collision.raycast(p, seg.clone().divideScalar(len), len, _hit2);
      if (hit) {
        if (hit.normal.y > 0.2 || hit.normal.dot(this.up(_v3)) > 0.5) this.landingNormal.copy(hit.normal);
        return;
      }
      p.add(seg);
      v.addScaledVector(G, step);
    }
  }

  _land(hit) {
    const m = new THREE.Vector3().copy(hit.normal);
    const up = this.up(new THREE.Vector3());
    const vn = -this.vel.dot(m);
    const vt = _vt.copy(this.vel).addScaledVector(m, vn);
    const vtLen = vt.length();
    // ---- judge the landing ----
    if (up.dot(m) < 0.55) return this._bail('Over-rotated', m);
    if (this.trick && !this.trick.caught && this.trick.t / this.trick.dur < 0.8) return this._bail("Didn't catch it", m);
    if (vn > 11.5) return this._bail('Too big', m);
    let sketchy = false;
    if (this.trick && !this.trick.caught) sketchy = true;
    if (this.grab) {
      if (vn > 5) return this._bail('Held the grab', m);
      sketchy = true;
    }
    // board alignment with travel direction
    const f = this.fwd(new THREE.Vector3());
    f.addScaledVector(m, -f.dot(m)).normalize();
    let yawFix = 0;
    if (vtLen > 1.1) {
      const vd = vt.clone().divideScalar(vtLen);
      const c = f.dot(vd);
      const target = c >= 0 ? vd : vd.clone().negate();
      const ang = Math.acos(clamp(Math.abs(c), -1, 1));
      if (ang > (48 * Math.PI) / 180) return this._bail('Landed sideways', m);
      if (ang > (22 * Math.PI) / 180) sketchy = true;
      yawFix = Math.atan2(_v2.crossVectors(f, target).dot(m), f.dot(target));
    }
    // ---- commit ----
    this.mode = 'ground';
    this.pos.copy(hit.point);
    this.normal.copy(m);
    this.surface = hit.surface;
    this.alignUp(m);
    this.rotateAround(m, yawFix * (sketchy ? 0.7 : 1));
    this.vel.copy(vt).multiplyScalar(sketchy ? 0.82 : 0.975);
    this.landCompress = clamp(vn / 6.5, 0.25, 1);
    this.groundT = 0;
    if (this.trick) {
      this.trick = null;
    }
    // shove-its leave the board turned around under the rider
    this.boardYawOffset = 0; // board visual is rebuilt from rider frame each frame
    this.emit(vn > 6.5 ? 'landHard' : 'land', { intensity: clamp(vn / 6, 0.2, 1) });

    const name = this._composeAirName();
    if (name) this._trickCallout(name, sketchy ? 'sketchy' : 'clean');
    this.popped = false;
    this.airTrickName = null;
    this.grab = null;
    this.grabs.clear();
    this.spinRate = 0;
    if (this.flick.state !== 'idle') this.flick.reset();
  }

  _composeAirName() {
    const parts = [];
    const deg = Math.abs(this.spinTotal) * (180 / Math.PI);
    const spins = Math.round(deg / 180) * 180;
    if (spins >= 180) {
      // positive yaw = frontside for regular riders
      const fs = Math.sign(this.spinTotal) * this.heelSign > 0;
      parts.push(`${fs ? 'FS' : 'BS'} ${spins}`);
    }
    let base = this.airTrickName;
    if (base === 'Ollie' && parts.length) base = null;
    if (base) parts.push(base);
    for (const g of this.grabs) parts.push(GRAB_NAMES[g]);
    if (!parts.length && this.airTime > 0.55) parts.push('Air');
    this.spinTotal = 0;
    return parts.join(' ');
  }

  // ---------------------------------------------------------------------------------------
  _tryGrind(input) {
    if (!this.rails.length) return false;
    const cp = _v1.copy(this.pos).addScaledVector(Y, 0.06);
    let best = null;
    let bestD = Infinity;
    for (const rail of this.rails) {
      if (this.railCooldown.has(rail)) continue;
      const ab = _v2.subVectors(rail.b, rail.a);
      const L2 = ab.lengthSq();
      if (L2 < 1e-6) continue;
      // quick reject
      const minX = Math.min(rail.a.x, rail.b.x) - 0.5, maxX = Math.max(rail.a.x, rail.b.x) + 0.5;
      const minZ = Math.min(rail.a.z, rail.b.z) - 0.5, maxZ = Math.max(rail.a.z, rail.b.z) + 0.5;
      if (cp.x < minX || cp.x > maxX || cp.z < minZ || cp.z > maxZ) continue;
      let t = _v3.subVectors(cp, rail.a).dot(ab) / L2;
      const L = Math.sqrt(L2);
      if (t < -0.05 / L || t > 1 + 0.05 / L) continue;
      t = clamp(t, 0, 1);
      const c = _v3.copy(rail.a).addScaledVector(ab, t);
      const dir = ab.divideScalar(L);
      const d = new THREE.Vector3().subVectors(cp, c);
      d.addScaledVector(dir, -d.dot(dir));
      // vertical-ish offset measured along the rail's up
      const railUp = new THREE.Vector3().copy(Y).addScaledVector(dir, -Y.dot(dir)).normalize();
      const dy = d.dot(railUp);
      const horiz = Math.sqrt(Math.max(0, d.lengthSq() - dy * dy));
      const vAlong = this.vel.dot(dir);
      const vUp = this.vel.dot(railUp);
      if (horiz > 0.22 || dy < -0.12 || dy > 0.22) continue;
      if (Math.abs(vAlong) < 0.8) continue;
      if (vUp > 1.2 && dy < 0) continue;
      const score = horiz + Math.abs(dy);
      if (score < bestD) {
        bestD = score;
        best = { rail, c: c.clone(), dir: dir.clone(), t, railUp, L };
      }
    }
    if (!best) return false;
    this._startGrind(best, input);
    return true;
  }

  _startGrind(g, input) {
    const { rail, c, railUp } = g;
    const vAlong = this.vel.dot(g.dir);
    const gdir = g.dir.clone().multiplyScalar(Math.sign(vAlong) || 1);
    const fwd = this.fwd(new THREE.Vector3());
    const fwdH = fwd.clone().addScaledVector(railUp, -fwd.dot(railUp)).normalize();
    const cosA = Math.abs(fwdH.dot(gdir));
    const slide = cosA < 0.64;
    // side the rail was approached from (toe side = frontside)
    const toe = this.side(new THREE.Vector3()).multiplyScalar(-this.heelSign);
    const toRail = c.clone().sub(this.pos);
    toRail.addScaledVector(gdir, -toRail.dot(gdir));
    const fs = toRail.dot(toe) > 0;
    const ledge = rail.kind === 'concrete' || rail.kind === 'wood';
    let type;
    const turn = Math.abs(input.steer) > 0.3;
    if (slide) type = input.nose ? 'Noseslide' : input.tail ? 'Tailslide' : ledge ? 'Boardslide' : 'Boardslide';
    else if (input.nose) type = turn ? 'Crooked Grind' : 'Nosegrind';
    else if (input.tail) type = turn ? (input.steer * this.heelSign > 0 ? 'Smith Grind' : 'Feeble Grind') : '5-0';
    else type = '50-50';
    // orient rider frame
    let newF;
    if (slide) {
      newF = new THREE.Vector3().crossVectors(railUp, gdir).normalize();
      if (newF.dot(fwdH) < 0) newF.negate();
    } else {
      newF = gdir.clone();
      if (newF.dot(fwdH) < 0) newF.negate();
    }
    const xAxis = new THREE.Vector3().crossVectors(railUp, newF).normalize();
    _m1.makeBasis(xAxis, railUp, newF);
    this.quat.setFromRotationMatrix(_m1);
    const speed = Math.abs(vAlong);
    this.grind = {
      rail,
      dir: gdir,
      up: railUp.clone(),
      c: c.clone(),
      speed,
      slide,
      type,
      name: `${fs ? 'FS' : 'BS'} ${type}`,
      kind: rail.kind,
      t: 0,
      fwdSign: newF.dot(gdir) >= 0 ? 1 : -1,
    };
    // collision impact: kill the perpendicular velocity
    this.vel.copy(gdir).multiplyScalar(speed);
    this.mode = 'grind';
    this.landCompress = 0.5;
    if (this.trick && !this.trick.caught && this.trick.t / this.trick.dur < 0.8) return this._bail("Didn't catch it");
    if (this.trick) this.trick = null;
    const pre = this._composeAirName();
    if (pre && pre !== 'Ollie' && pre !== 'Air') this._trickCallout(pre, 'clean');
    this.airTrickName = null;
    this.grabs.clear();
    this.grab = null;
    this.spinRate = 0;
    this._placeOnRail();
    this.emit(slide ? 'slideStart' : 'grindStart', { kind: rail.kind });
  }

  _placeOnRail() {
    const g = this.grind;
    const fwd = this.fwd(_v1);
    this.pos.copy(g.c);
    if (g.slide) {
      this.pos.addScaledVector(g.up, -BOARD.deckBottomY);
      if (g.type === 'Noseslide') this.pos.addScaledVector(fwd, -0.3);
      if (g.type === 'Tailslide') this.pos.addScaledVector(fwd, 0.3);
    } else {
      this.pos.addScaledVector(g.up, -(BOARD.wheelRadius + 0.006));
      if (g.type === '5-0' || g.type === 'Smith Grind' || g.type === 'Feeble Grind') this.pos.addScaledVector(fwd, BOARD.truckAxleZ);
      if (g.type === 'Nosegrind' || g.type === 'Crooked Grind') this.pos.addScaledVector(fwd, -BOARD.truckAxleZ);
    }
  }

  _grindStep(dt, input) {
    const g = this.grind;
    g.t += dt;
    const fr = (RAIL_KINDS[g.kind]?.friction ?? 0.8) * (g.slide ? 1.5 : 1);
    g.speed += (G.dot(g.dir) - fr) * dt;
    g.c.addScaledVector(g.dir, g.speed * dt);
    this.vel.copy(g.dir).multiplyScalar(g.speed);
    this._placeOnRail();
    this.wheelSpin += g.slide ? 0 : (g.speed * dt) / BOARD.wheelRadius * 0.2;
    const ab = _v1.subVectors(g.rail.b, g.rail.a);
    const t = _v2.subVectors(g.c, g.rail.a).dot(ab) / ab.lengthSq();
    if (t < 0 || t > 1) return this._endGrind(true);
    if (g.speed < 0.25) {
      // ran out of speed: drop off the side
      const off = this.side(_v1).multiplyScalar(0.8 * (Math.random() < 0.5 ? 1 : -1));
      this.vel.add(off);
      return this._endGrind(true);
    }
  }

  _endGrind(toAir) {
    const g = this.grind;
    if (!g) return;
    this.railCooldown.set(g.rail, 0.35);
    if (g.t > 0.15) this._trickCallout(g.name, 'clean');
    this.emit('grindEnd');
    this.grind = null;
    this.exitTurn = 0;
    if (g.slide) {
      // shoulders turn back to ride away forward/fakie out of slides
      const f = this.fwd(_v1);
      const d = g.dir;
      const n = g.up;
      const c = f.dot(d) >= 0 ? d : _v2.copy(d).negate();
      this.exitTurn = Math.atan2(_v3.crossVectors(f, c).dot(n), f.dot(c));
    }
    if (toAir) {
      this.mode = 'air';
      this.airTime = 0.05;
      this.popped = false;
      this.airTrickName = null;
      this.landingNormal.copy(Y);
      this.predictT = 0;
      // re-level the rider up axis
    }
  }

  // ---------------------------------------------------------------------------------------
  _bail(reason, normal = null) {
    if (this.mode === 'bail') return;
    if (this.grind) {
      this.emit('grindEnd');
      this.grind = null;
    }
    this.mode = 'bail';
    this.bailT = 0;
    this.bailReason = reason;
    this.trick = null;
    this.grab = null;
    this.manual = 0;
    this.loading = false;
    this.lineActive = false;
    // board flies off on its own
    const b = this.board;
    const m = this.boardMatrix(new THREE.Matrix4());
    m.decompose(b.pos, b.quat, _v1);
    b.vel.copy(this.vel).multiplyScalar(0.85);
    b.vel.y = Math.max(b.vel.y, 0) + 1.5 + Math.random();
    if (normal) b.vel.addScaledVector(normal, 1.5);
    b.ang.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 14);
    this.emit('bail', { reason, velocity: this.vel.clone() });
  }

  forceBail() {
    if (this.mode !== 'bail') this._bail('Bailed');
  }

  _bailStep(dt, input) {
    this.bailT += dt;
    // board rigid body
    const b = this.board;
    b.vel.addScaledVector(G, dt);
    b.pos.addScaledVector(b.vel, dt);
    const hit = this.collision.raycast(_v1.copy(b.pos).addScaledVector(Y, 0.4), _v2.set(0, -1, 0), 0.45, _hit);
    if (hit) {
      b.pos.y = Math.max(b.pos.y, hit.point.y + 0.03);
      const vn = b.vel.dot(hit.normal);
      if (vn < 0) {
        b.vel.addScaledVector(hit.normal, -vn * 1.35);
        if (-vn > 1.5) this.emit('boardHit', { intensity: clamp(-vn / 5, 0.1, 1) });
      }
      b.vel.multiplyScalar(Math.exp(-2.5 * dt));
      b.ang.multiplyScalar(Math.exp(-4 * dt));
    }
    // walls for the board
    const sp = b.vel.length();
    if (sp > 0.1) {
      const wh = this.collision.raycast(b.pos, _v1.copy(b.vel).divideScalar(sp), sp * dt + 0.2, _hit);
      if (wh && wh.normal.y < 0.5) {
        const vn = b.vel.dot(wh.normal);
        if (vn < 0) b.vel.addScaledVector(wh.normal, -vn * 1.4);
      }
    }
    const angLen = b.ang.length();
    if (angLen > 1e-4) {
      _q1.setFromAxisAngle(_v1.copy(b.ang).divideScalar(angLen), angLen * dt);
      b.quat.premultiply(_q1).normalize();
    }
    if (this.bailT > 2.6 || (this.bailT > 0.9 && (input.respawn || input.push || input.ollie))) this.respawn();
  }

  respawn() {
    // last safe spot from ~1.5s before trouble
    let snap = null;
    for (let i = this.snapshots.length - 1; i >= 0; i--) {
      if (this.time - this.snapshots[i].t > 1.4) {
        snap = this.snapshots[i];
        break;
      }
    }
    snap = snap || this.snapshots[0];
    if (snap) {
      this.reset(snap.pos, 0, null);
      this.quat.copy(snap.quat);
      this.normal.copy(snap.normal);
      this._groundCheck();
    } else this.reset(this.lastGroundPos, 0);
    this.snapshots.length = 0;
    this.emit('respawn');
  }

  setMarker() {
    if (this.mode !== 'ground') return false;
    this.marker = { pos: this.pos.clone(), quat: this.quat.clone(), normal: this.normal.clone() };
    return true;
  }

  gotoMarker() {
    if (!this.marker) return false;
    this.reset(this.marker.pos, 0, null);
    this.quat.copy(this.marker.quat);
    this.normal.copy(this.marker.normal);
    this._groundCheck();
    this.snapshots.length = 0;
    return true;
  }

  teleport(position, yaw) {
    this.reset(position, yaw);
    this.snapshots.length = 0;
  }

  // ---------------------------------------------------------------------------------------
  // Visual outputs
  riderMatrix(target) {
    return target.compose(this.pos, this.quat, _v1.set(1, 1, 1));
  }

  boardMatrix(target) {
    if (this.mode === 'bail') return target.compose(this.board.pos, this.board.quat, _v1.set(1, 1, 1));
    this.riderMatrix(target);
    const local = _m2.identity();
    const t = new THREE.Matrix4();
    // powerslide: board + rider turned sideways (visual)
    // trick rotations about the board's center
    let pitch = 0;
    let shove = 0;
    let flip = 0;
    let lift = 0;
    // ollie pop pitch: tail strike then level out
    if (this.popT < 0.4) {
      const tt = this.popT;
      const p = tt < 0.07 ? tt / 0.07 : Math.max(0, 1 - (tt - 0.07) / 0.28);
      pitch = -0.42 * easeInOut(p) * (this.popNose ? -1 : 1);
    }
    if (this.trick) {
      const k = clamp(this.trick.t / this.trick.dur, 0, 1);
      const e = this.trick.flips ? k : easeInOut(k);
      flip = this.trick.flipTotal * e;
      shove = this.trick.shoveTotal * e;
      lift = Math.sin(k * Math.PI) * 0.1;
    }
    if (this.mode === 'ground' && this.manual) {
      const pz = this.manual > 0 ? -BOARD.truckAxleZ : BOARD.truckAxleZ;
      const a = this.manual > 0 ? -0.2 : 0.2;
      local.multiply(t.makeTranslation(0, BOARD.wheelRadius, pz)).multiply(new THREE.Matrix4().makeRotationX(a)).multiply(new THREE.Matrix4().makeTranslation(0, -BOARD.wheelRadius, -pz));
    }
    if (this.mode === 'grind' && this.grind) {
      const ty = this.grind.type;
      let a = 0;
      if (ty === 'Nosegrind' || ty === 'Crooked Grind') a = 0.22;
      if (ty === '5-0' || ty === 'Smith Grind' || ty === 'Feeble Grind') a = -0.22;
      if (ty === 'Noseslide') a = 0.12;
      if (ty === 'Tailslide') a = -0.12;
      if (a) local.multiply(new THREE.Matrix4().makeRotationX(a));
    }
    if (this.mode === 'ground') {
      // carve: deck rolls into the turn
      local.multiply(new THREE.Matrix4().makeRotationZ(-this.lean * 0.09));
    }
    if (pitch || shove || flip || lift) {
      const py = BOARD.pivotY;
      local
        .multiply(t.makeTranslation(0, py + lift, 0))
        .multiply(new THREE.Matrix4().makeRotationX(pitch))
        .multiply(new THREE.Matrix4().makeRotationY(shove))
        .multiply(new THREE.Matrix4().makeRotationZ(flip))
        .multiply(new THREE.Matrix4().makeTranslation(0, -py, 0));
    }
    if (this.slide > 0.01) local.premultiply(new THREE.Matrix4().makeRotationY(this.slide * 1.25 * this.heelSign));
    return target.multiply(local);
  }

  getPose(pose) {
    const riderM = this.riderMatrix(pose.rider);
    if (this.slide > 0.01) riderM.multiply(_m1.makeRotationY(this.slide * 1.25 * this.heelSign));
    this.boardMatrix(pose.board);
    pose.stance = this.stance;
    let state = 'ride';
    if (this.mode === 'air') state = 'air';
    else if (this.mode === 'grind') state = this.grind?.slide ? 'slide' : 'grind';
    else if (this.manual > 0) state = 'manual';
    else if (this.manual < 0) state = 'nosemanual';
    else if (this.slide > 0.3) state = 'powerslide';
    else if (this.pushT >= 0) state = 'push';
    else if (this.braking) state = 'brake';
    pose.state = state;
    pose.crouch = this.crouch;
    pose.lean = this.lean;
    pose.pushPhase = Math.max(0, this.pushT);
    pose.feetOnBoard = !(this.trick && this.trick.t < this.trick.dur * 0.92);
    pose.flick = this.flickT < 1 ? this.flickAnim : 0;
    pose.flickT = this.flickT;
    pose.tuck = this.mode === 'air' ? clamp(0.25 + (this.trick ? 0.55 : 0) + (this.grab ? 0.5 : 0), 0, 1) : 0;
    pose.grab = this.grab;
    pose.slide = this.slide;
    pose.armSwing = clamp(this.mode === 'air' ? this.spinRate / 7 : this.lean * 0.3, -1, 1);
    pose.velocity.copy(this.vel);
    pose.speed = this.vel.length();
    pose.time = this.time;
    pose.loadNose = this.loadNose;
    return pose;
  }
}
