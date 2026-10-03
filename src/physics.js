export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
export const SPAWNS = {
  plaza: { x: 0, z: -21, yaw: 0, name: 'The plaza' },
  bowl: { x: -18, z: -4, yaw: 0, name: 'The bowl' },
  street: { x: 17, z: -19, yaw: 0, name: 'Street line' },
};

export function makeObstacles() {
  return [
    { id: 'rail-1', type: 'rail', x: 0, z: -3, yaw: 0, length: 7, height: .52 },
    { id: 'rail-2', type: 'rail', x: 8, z: 17, yaw: Math.PI / 2, length: 7, height: .64 },
    { id: 'pad-1', type: 'ledge', x: 7, z: -9, yaw: 0, width: 2.5, length: 7, height: .42 },
    { id: 'pad-2', type: 'ledge', x: -8, z: -15, yaw: Math.PI / 2, width: 2.2, length: 6, height: .38 },
    { id: 'ramp-1', type: 'ramp', x: 18, z: -5, yaw: 0, width: 6, length: 9, height: 1.35 },
    { id: 'ramp-2', type: 'ramp', x: 16, z: 16, yaw: Math.PI / 2, width: 5, length: 8, height: 1.1 },
    { id: 'stairs', type: 'stairs', x: -6, z: 22, yaw: 0, width: 6, length: 9, height: 1.2 },
  ];
}
export function localPoint(o, x, z) {
  const dx = x - o.x, dz = z - o.z, c = Math.cos(o.yaw), s = Math.sin(o.yaw);
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}
export function baseHeight(x, z) {
  const r = Math.hypot(x + 18, z - 13);
  if (r < 10) {
    const t = clamp((r - 5.5) / 4.5, 0, 1);
    return -2.5 * (.5 + .5 * Math.cos(Math.PI * t));
  }
  if (z > 30 && Math.abs(x) < 28) {
    const t = clamp((z - 30) / 6, 0, 1);
    return 3.2 * (1 - Math.cos(t * Math.PI / 2));
  }
  return 0;
}
export function obstacleHeight(o, x, z) {
  if (o.type === 'rail') return -Infinity;
  const p = localPoint(o, x, z);
  if (Math.abs(p.x) > o.width / 2 || Math.abs(p.z) > o.length / 2) return -Infinity;
  if (o.type === 'ramp') return o.height * Math.min(1, (o.length / 2 - Math.abs(p.z)) / (o.length * .35));
  if (o.type === 'stairs') {
    const t = (p.z + o.length / 2) / o.length;
    return t < .45 ? o.height * t / .45 : o.height * Math.ceil((1 - t) / .55 * 6) / 6;
  }
  return o.height;
}
export function terrainHeight(x, z, obstacles = []) {
  let y = baseHeight(x, z);
  for (const o of obstacles) y = Math.max(y, obstacleHeight(o, x, z));
  return y;
}
export class SkatePhysics {
  constructor(obstacles = makeObstacles()) {
    this.obstacles = obstacles;
    this.events = [];
    this.total = 0; this.bestLine = 0; this.combo = 0; this.multiplier = 1;
    this.comboTimer = 0; this.distance = 0; this.landed = 0; this.grinds = 0;
    this.grip = .7; this.spawn = 'plaza'; this.reset();
  }
  emit(type, data = {}) { this.events.push({ type, ...data }); }
  reset(spawn = this.spawn) {
    this.spawn = spawn; const p = SPAWNS[spawn] || SPAWNS.plaza;
    this.x = p.x; this.z = p.z; this.y = terrainHeight(p.x, p.z, this.obstacles);
    this.yaw = p.yaw; this.vx = 0; this.vz = 0; this.vy = 0;
    this.grounded = true; this.charge = 0; this.wasCharging = false;
    this.flip = null; this.shuv = null; this.airTricks = []; this.airTime = 0;
    this.airSpin = 0; this.bailTime = 0; this.rail = null; this.grindTime = 0;
    this.manualTime = 0; this.manualPoints = 0; this.pitch = 0; this.roll = 0;
    this.combo = 0; this.multiplier = 1; this.comboTimer = 0; this.justPopped = 0;
  }
  get speed() { return Math.hypot(this.vx, this.vz); }
  pop(charge = this.charge) {
    if ((!this.grounded && !this.rail) || this.bailTime > 0) return false;
    this.rail = null; this.grounded = false; this.vy = 4.3 + clamp(charge, 0, 1) * 2.25;
    this.y += .035; this.airTime = 0; this.airSpin = 0; this.airTricks = [];
    this.justPopped = .12; this.charge = 0; this.emit('pop'); return true;
  }
  trick(kind) {
    if (this.grounded || this.rail || this.bailTime > 0) return;
    if (kind === 'shuvit' && !this.shuv) {
      this.shuv = { t: 0, duration: .52, done: false }; this.emit('trick', { name: '360 shuvit' });
    } else if (kind !== 'shuvit' && !this.flip) {
      this.flip = { t: 0, duration: .53, direction: kind === 'heelflip' ? -1 : 1, kind, done: false };
      this.emit('trick', { name: kind === 'heelflip' ? 'Heelflip' : 'Kickflip' });
    }
  }
  bail(reason = 'Find your feet') {
    if (this.bailTime > 0) return;
    this.bailTime = 1.15; this.combo = 0; this.comboTimer = 0; this.multiplier = 1;
    this.rail = null; this.charge = 0; this.wasCharging = false; this.manualPoints = 0;
    this.emit('bail', { reason });
  }
  score(name, points) {
    this.combo += Math.round(points * this.multiplier); this.multiplier = Math.min(8, this.multiplier + 1);
    this.comboTimer = 3; this.emit('score', { name, points: Math.round(points), combo: this.combo });
  }
  bank() {
    if (!this.combo) return;
    this.total += this.combo; this.bestLine = Math.max(this.bestLine, this.combo);
    this.emit('bank', { points: this.combo }); this.combo = 0; this.multiplier = 1;
  }
  land() {
    const badFlip = this.flip && !this.flip.done && this.flip.t / this.flip.duration < .86;
    const badShuv = this.shuv && !this.shuv.done && this.shuv.t / this.shuv.duration < .84;
    const heading = Math.atan2(this.vx, this.vz);
    const alignment = Math.abs(wrap(this.yaw - heading));
    if (badFlip || badShuv || (this.speed > 2.5 && alignment > .8 && alignment < Math.PI - .8)) {
      this.bail(badFlip || badShuv ? 'Let the board finish its rotation' : 'Land with your wheels facing the line');
    } else if (this.airTime > .15) {
      const spin = Math.round(Math.abs(this.airSpin) / Math.PI) * 180;
      const names = [...this.airTricks]; if (spin >= 180) names.push(`${spin}°`);
      this.score(names.length ? names.join(' + ') : 'Ollie', 100 + this.airTricks.length * 250 + spin);
      this.landed++; this.emit('land', { impact: Math.abs(this.vy) });
      if (this.speed > 1) this.yaw = heading + (alignment > Math.PI / 2 ? Math.PI : 0);
    }
    this.flip = null; this.shuv = null; this.airTime = 0; this.airTricks = [];
    this.grounded = true; this.vy = 0; this.airSpin = 0;
  }
  step(dt, input = {}) {
    dt = Math.min(dt, 1 / 30);
    if (this.bailTime > 0) {
      this.bailTime -= dt; this.vx *= Math.exp(-4 * dt); this.vz *= Math.exp(-4 * dt);
      if (this.bailTime <= 0) { this.reset(); this.emit('respawn'); } return;
    }
    this.justPopped = Math.max(0, this.justPopped - dt);
    if (input.charge) this.charge = clamp(this.charge + dt * 1.8, 0, 1);
    if (this.wasCharging && !input.charge) this.pop();
    this.wasCharging = !!input.charge;
    if (input.kickflip) this.trick('kickflip');
    if (input.heelflip) this.trick('heelflip');
    if (input.shuvit) this.trick('shuvit');
    for (const [key, name] of [['flip', this.flip?.kind === 'heelflip' ? 'Heelflip' : 'Kickflip'], ['shuv', '360 shuvit']]) {
      const t = this[key];
      if (t && !t.done) { t.t += dt; if (t.t >= t.duration) { t.done = true; this.airTricks.push(name); } }
    }
    if (this.rail) {
      const rail = this.rail; const p = localPoint(rail, this.x, this.z);
      if (!input.grind || Math.abs(p.z) > rail.length / 2 + .12 || this.speed < .8) {
        this.score('50–50 grind', 150 + this.grindTime * 240); this.grinds++;
        this.rail = null; this.grounded = false; this.vy = .4; this.airTime = 0;
      } else {
        this.grindTime += dt; this.x += this.vx * dt; this.z += this.vz * dt;
        this.vx *= Math.exp(-.12 * dt); this.vz *= Math.exp(-.12 * dt);
        this.y = rail.height - .025; this.comboTimer = 3; return;
      }
    }
    const speed = this.speed, steer = clamp(input.steer || 0, -1, 1);
    if (this.grounded) {
      const reverse = this.vx * Math.sin(this.yaw) + this.vz * Math.cos(this.yaw) < -.2 ? -1 : 1;
      this.yaw += steer * reverse * (1.1 + Math.min(speed / 6, 1)) * dt * (input.brake ? 1.6 : 1);
      if (input.push && !input.charge) {
        const acceleration = 4.2 * Math.max(.08, 1 - speed / 12);
        this.vx += Math.sin(this.yaw) * acceleration * dt;
        this.vz += Math.cos(this.yaw) * acceleration * dt;
      }
      const h = terrainHeight(this.x, this.z, this.obstacles), e = .13;
      // Sample only continuous slopes. A ledge edge must collide, never act like a spring.
      const dx = terrainHeight(this.x + e, this.z, this.obstacles) - terrainHeight(this.x - e, this.z, this.obstacles);
      const dz = terrainHeight(this.x, this.z + e, this.obstacles) - terrainHeight(this.x, this.z - e, this.obstacles);
      const gx = Math.abs(dx) > .25 ? 0 : clamp(dx / (e * 2), -1.6, 1.6);
      const gz = Math.abs(dz) > .25 ? 0 : clamp(dz / (e * 2), -1.6, 1.6);
      this.vx -= gx * 10 * dt; this.vz -= gz * 10 * dt;
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), forward = this.vx * fx + this.vz * fz;
      const grip = 1 - Math.exp(-(input.brake ? 2.5 : 8 + this.grip * 12) * dt);
      this.vx += (fx * forward - this.vx) * grip; this.vz += (fz * forward - this.vz) * grip;
      const drag = Math.exp(-(input.brake ? 3.7 : .12) * dt);
      this.vx *= drag; this.vz *= drag;
      this.pitch = Math.atan(gx * fx + gz * fz);
      this.roll = -steer * Math.min(speed / 8, 1) * .17;
      this.vy = gx * this.vx + gz * this.vz;
      this.y = h;
      if (input.manual && speed > 1.5 && !input.charge) {
        this.manualTime += dt; this.manualPoints += dt * 100; this.comboTimer = 3;
      } else if (this.manualTime > 0) {
        if (this.manualTime > .4) this.score('Manual', Math.min(1500, this.manualPoints));
        this.manualTime = 0; this.manualPoints = 0;
      }
    } else {
      const spin = clamp(input.spin || 0, -1, 1) * 5.2 * dt;
      this.yaw += spin; this.airSpin += spin; this.vy -= 16 * dt;
      this.airTime += dt; this.pitch *= Math.exp(-7 * dt); this.roll *= Math.exp(-7 * dt);
    }
    const nx = this.x + this.vx * dt, nz = this.z + this.vz * dt;
    const nextHeight = terrainHeight(nx, nz, this.obstacles);
    if (this.grounded && nextHeight - this.y > .26) { this.bail('Ollie onto the ledge'); return; }
    this.x = nx; this.z = nz; this.distance += speed * dt;
    if (this.grounded) {
      const expected = this.y + this.vy * dt;
      if (nextHeight < expected - .018 && speed > 2 && this.vy > .35) {
        this.grounded = false; this.y = expected; this.airTime = 0; this.airTricks = [];
      } else if (nextHeight < this.y - .22) {
        this.grounded = false; this.vy = 0; this.airTime = 0; this.airTricks = [];
      } else this.y = nextHeight;
    } else {
      const prevY = this.y; this.y += this.vy * dt;
      if (input.grind && this.vy <= 1 && this.justPopped <= 0) {
        for (const o of this.obstacles.filter(o => o.type === 'rail')) {
          const p = localPoint(o, this.x, this.z);
          const aligned = Math.abs(Math.cos(this.yaw - o.yaw)) > .78;
          if (Math.abs(p.x) < .42 && Math.abs(p.z) < o.length / 2 + .1 && this.y <= o.height + .14 && prevY >= o.height - .22 && speed > 1.1 && aligned) {
            this.rail = o; this.grindTime = 0; this.y = o.height - .025; this.vy = 0;
            const sign = Math.cos(Math.atan2(this.vx, this.vz) - o.yaw) >= 0 ? 1 : -1;
            this.x = o.x + Math.sin(o.yaw) * p.z; this.z = o.z + Math.cos(o.yaw) * p.z;
            this.vx = Math.sin(o.yaw) * speed * sign; this.vz = Math.cos(o.yaw) * speed * sign;
            this.yaw = o.yaw + (sign < 0 ? Math.PI : 0); this.flip = null; this.shuv = null;
            if (this.airTricks.length) this.score(this.airTricks.join(' + '), this.airTricks.length * 250);
            this.emit('grind'); break;
          }
        }
      }
      if (!this.rail && this.y <= nextHeight && this.justPopped <= 0) { this.y = nextHeight; this.land(); }
    }
    if (Math.abs(this.x) > 32 || this.z < -34 || this.z > 36.5 || this.y < -8) this.bail('Edge of the park · back to your session');
    if (this.grounded && this.comboTimer > 0 && !input.manual) {
      this.comboTimer -= dt; if (this.comboTimer <= 0) this.bank();
    }
  }
}
