// "Flick-it" gesture recognizer. Turns the analog right stick (or the mouse virtual stick)
// into skate-style trick inputs: pull back to load the tail, flick forward to pop.
//
// Coordinates fed in are already mirrored for stance so +u is always the rider's HEEL side
// (screen-left for a regular rider seen from behind), v is up/forward.
//
// Angles: theta is measured from the load direction (0) and is positive toward the heel side.

const LOAD_MAG = 0.72;
const LOAD_ZONE = (40 * Math.PI) / 180;
const RIM_MAG = 0.6;

const wrap = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

export const TRICKS = {
  '0,0': 'Ollie',
  '1,0': 'Kickflip',
  '-1,0': 'Heelflip',
  '2,0': 'Double Kickflip',
  '-2,0': 'Double Heelflip',
  '3,0': 'Triple Kickflip',
  '-3,0': 'Triple Heelflip',
  '0,1': 'Pop Shove-it',
  '0,-1': 'FS Pop Shove-it',
  '0,2': '360 Shove-it',
  '0,-2': 'FS 360 Shove-it',
  '1,1': 'Varial Kickflip',
  '-1,-1': 'Varial Heelflip',
  '1,-1': 'Hardflip',
  '-1,1': 'Inward Heelflip',
  '1,2': '360 Flip',
  '-1,-2': 'Laser Flip',
  '2,1': 'Double Varial Kickflip',
  '-2,-1': 'Double Varial Heelflip',
  '2,2': 'Double 360 Flip',
  '0,3': '540 Shove-it',
  '0,-3': 'FS 540 Shove-it',
  '0,4': '720 Shove-it',
  '2,4': 'Double 360 Flip',
  '-2,-4': 'Double Laser Flip',
  '2,-2': 'Double Hardflip',
  '-2,2': 'Double Inward Heelflip',
  '1,3': '540 Flip',
  '-1,-3': '540 Laser Flip',
};

export function trickName(flips, shove, nollie, fakie, imp = 0) {
  let base = imp ? (Math.abs(imp) > 1 ? `${Math.abs(imp) === 2 ? 'Double' : Math.abs(imp) + 'x'} Impossible` : 'Impossible') : TRICKS[`${flips},${shove}`];
  if (!base) {
    const parts = [];
    if (shove) parts.push(`${Math.abs(shove) * 180} ${shove > 0 ? 'BS' : 'FS'} Shove`);
    if (flips) parts.push(`${Math.abs(flips) > 1 ? Math.abs(flips) + 'x ' : ''}${flips > 0 ? 'Kickflip' : 'Heelflip'}`);
    base = parts.join(' ') || 'Ollie';
  }
  if (nollie) return base === 'Ollie' ? 'Nollie' : 'Nollie ' + base;
  if (fakie) return 'Fakie ' + base;
  return base;
}

export class FlickRecognizer {
  constructor() {
    this.reset();
    this.trail = [];
  }

  reset() {
    this.state = 'idle'; // idle | loaded | pending | cooldown
    this.nose = false;
    this.sweep = 0;
    this.prevTheta = 0;
    this.loadT = 0;
    this.leaveT = -1;
    this.sideT = 0;
    this.pendingT = 0;
    this.lowT = 0;
    this.t = 0;
    this.lastLowMagT = 0;
    this.lastMag = 0;
    this.loadedAmount = 0;
  }

  get loaded() {
    return this.state === 'loaded' || this.state === 'pending';
  }

  // u: heel-side +, v: up +. canLoad: on the ground / grinding / manual. airborne: allow late flicks.
  // Returns null or an event object.
  // manual: mouse hold mode. Pops never fire on their own; release() fires them.
  update(dt, u, v, { canLoad, airborne, lateAllowed, manual = false }) {
    this.manual = manual;
    this.t += dt;
    const mag = Math.hypot(u, v);
    this.trail.push({ x: u, y: v, t: this.t });
    while (this.trail.length && this.t - this.trail[0].t > 0.35) this.trail.shift();
    if (mag < 0.3) this.lastLowMagT = this.t;

    switch (this.state) {
      case 'idle': {
        if (canLoad && mag > LOAD_MAG) {
          const thDown = Math.atan2(u, -v); // 0 = down
          const thUp = Math.atan2(u, v); // 0 = up
          if (Math.abs(thDown) < LOAD_ZONE) return this._load(false, u, v);
          if (Math.abs(thUp) < LOAD_ZONE) return this._load(true, u, v);
        }
        // late flip: a fast flick out of the center while in the air
        if (airborne && lateAllowed && mag > 0.85 && this.t - this.lastLowMagT < 0.12) {
          this.state = 'cooldown';
          return this._lateFlick(u, v);
        }
        return null;
      }
      case 'loaded': {
        const [lu, lv] = this._local(u, v);
        const th = Math.atan2(lu, -lv);
        this._sweepStep(th, mag);
        if (mag < 0.25) {
          this.lowT += dt;
          if (this.lowT > 0.5) {
            this.state = 'idle';
            return { type: 'unload' };
          }
        } else this.lowT = 0;
        const inLoad = mag > 0.55 && Math.abs(th) < LOAD_ZONE + 0.15;
        if (!inLoad && this.leaveT < 0) this.leaveT = this.t;
        if (inLoad) {
          this.leaveT = -1;
          this.loadedAmount = Math.min(1, this.loadedAmount + dt / 0.18);
        }
        if (lv > 0.5 && mag > 0.5 && this.topT < 0) this.topT = this.t;
        if (this.manual) {
          if (mag >= 0.55 && this.leaveT > 0) {
            this.lastLU = lu;
            this.lastLV = lv;
            this.hasStrong = true;
          }
          return null;
        }
        // reached the far side -> brief pending window to read the final direction
        if (lv > 0.5 && mag > 0.5) {
          this.state = 'pending';
          this.pendingT = 0;
          this.lastSweep = this.sweep;
          this.lastLU = lu;
          this.lastLV = lv;
          return null;
        }
        if (mag >= 0.55 && this.leaveT > 0) {
          this.lastLU = lu;
          this.lastLV = lv;
          this.hasStrong = true;
        }
        // side ending (pop shove-its): sitting at the side
        const atSide = mag > 0.7 && Math.abs(lu) > 0.8 && lv < 0.45 && this.leaveT > 0;
        if (atSide) {
          this.sideT += dt;
          if (this.sideT > 0.14) return this._pop(lu, lv);
        } else this.sideT = 0;
        // let go mid-gesture: use the last committed stick position
        if (mag < 0.35 && this.hasStrong && (Math.abs(this.sweep) > 1.05 || this.lastLV > 0.25 || Math.abs(this.lastLU) > 0.8)) {
          return this._pop(this.lastLU, this.lastLV);
        }
        return null;
      }
      case 'pending': {
        const [lu, lv] = this._local(u, v);
        const th = Math.atan2(lu, -lv);
        this._sweepStep(th, mag);
        this.pendingT += dt;
        if (mag >= 0.5) {
          this.lastLU = lu;
          this.lastLV = lv;
        }
        // keep listening while the stick is still travelling around the rim (360 flips / lasers)
        const rimSpeed = mag > RIM_MAG ? Math.abs(this.sweep - (this.lastSweep ?? this.sweep)) / dt : 0;
        this.lastSweep = this.sweep;
        const settling = rimSpeed < 5 || this.pendingT > 0.16;
        if (mag < 0.4) return this._pop(this.lastLU, this.lastLV);
        if (this.pendingT >= 0.04 && settling) return this._pop(lu, lv);
        return null;
      }
      case 'cooldown': {
        if (mag < 0.35) this.state = 'idle';
        return null;
      }
    }
    return null;
  }

  // Mouse button released: pop with the gesture drawn while it was held (or cancel).
  release() {
    if (!this.loaded) {
      this.state = 'idle';
      return null;
    }
    const committed = this.hasStrong && (this.lastLV > 0.25 || Math.abs(this.sweep) > 1.05 || Math.abs(this.lastLU) > 0.8);
    if (!committed) {
      this.state = 'idle';
      return { type: 'unload' };
    }
    const ev = this._pop(this.lastLU, this.lastLV);
    this.state = 'idle';
    return ev;
  }

  // Accumulate travel around the rim. A jump between samples whose chord cuts near the center
  // (a fast flick straight across, common with mice at low frame rates) is not rim travel.
  _sweepStep(th, mag) {
    if (mag > RIM_MAG && this.prevMag > RIM_MAG) {
      const d = wrap(th - this.prevTheta);
      if (Math.cos(Math.abs(d) / 2) * Math.min(mag, this.prevMag) > 0.5) this.sweep += d;
    }
    this.prevTheta = th;
    this.prevMag = mag;
  }

  _local(u, v) {
    // nose loads are mirrored vertically so the same classification applies
    return this.nose ? [u, -v] : [u, v];
  }

  _load(nose, u, v) {
    this.state = 'loaded';
    this.nose = nose;
    this.sweep = 0;
    const [lu, lv] = this._local(u, v);
    this.prevTheta = Math.atan2(lu, -lv);
    this.prevMag = Math.hypot(u, v);
    this.loadT = this.t;
    this.leaveT = -1;
    this.sideT = 0;
    this.lowT = 0;
    this.loadedAmount = 0.3;
    this.hasStrong = false;
    this.topT = -1;
    return { type: 'load', nose };
  }

  _pop(lu, lv) {
    const S = (this.sweep * 180) / Math.PI;
    const aS = Math.abs(S);
    const endU = lu;
    const endT = this.topT > 0 ? this.topT : this.t;
    const flickTime = this.leaveT > 0 ? Math.max(0, endT - this.leaveT) : 0.12;
    let flips = 0;
    let shove = 0;
    let imp = 0;
    if (aS < 60) {
      if (endU > 0.32) flips = 1;
      else if (endU < -0.32) flips = -1;
      if (lv < 0.45 && Math.abs(endU) > 0.8) {
        // went straight across to the side through the middle: treat as a pop shove-it
        flips = 0;
        shove = endU > 0 ? 1 : -1;
      }
    } else if (aS < 160) {
      const sgn = Math.sign(S);
      if (lv < 0.5) shove = sgn;
      else if (Math.abs(endU) <= 0.3) shove = aS >= 140 ? 2 * sgn : sgn;
      else {
        shove = sgn;
        flips = Math.sign(endU) === sgn ? sgn : -sgn;
      }
    } else if (aS < 205) {
      shove = 2 * Math.sign(S);
      if (Math.abs(endU) > 0.45 && Math.sign(endU) === -Math.sign(S)) flips = Math.sign(S); // 360 flip / laser
    } else if (aS < 300) {
      shove = 2 * Math.sign(S);
      flips = Math.sign(S);
    } else {
      // all the way around: the board wraps end-over-end around the back foot
      imp = Math.sign(S);
    }
    // pop power: fast, committed flicks after a full load pop higher
    const speedFactor = Math.max(0, Math.min(1, 1 - (flickTime - 0.05) / 0.3));
    const power = Math.max(0.25, Math.min(1, 0.35 + 0.45 * speedFactor + 0.25 * this.loadedAmount));
    this.state = 'cooldown';
    return { type: 'pop', nose: this.nose, flips, shove, imp, power, late: false };
  }

  _lateFlick(u, v) {
    let flips = 0, shove = 0;
    const ang = Math.atan2(u, v); // 0 = up, + heel side
    const a = Math.abs(ang);
    if (a < 0.5) return null; // straight up flick: nothing (no ollie in the air)
    if (a > 2.4) shove = ang > 0 ? 1 : -1; // flicked down-ish
    else if (ang > 0) flips = 1;
    else flips = -1;
    return { type: 'pop', nose: false, flips, shove, power: 0, late: true };
  }
}
