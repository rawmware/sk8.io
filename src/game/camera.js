import * as THREE from 'three';

// skate-style follow camera: low, wide, trailing the direction of travel (not the board's yaw),
// so spins and flips read clearly. Smooth critically-damped motion + collision pull-in.

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _hit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: '' };

export class CameraRig {
  constructor(camera, collision) {
    this.camera = camera;
    this.collision = collision;
    this.heading = 0; // yaw of the travel direction
    this.pos = new THREE.Vector3(0, 2, -4);
    this.look = new THREE.Vector3();
    this.distance = 2.9;
    this.height = 1.05;
    this.mode = 0; // 0 follow, 1 low "filmer", 2 high
    this.focusHeight = 0.85;
  }

  snap(target, heading) {
    this.heading = heading;
    this._desired(target, _v1);
    this.pos.copy(_v1);
    this.look.copy(target).y += this.focusHeight;
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }

  _desired(target, out) {
    const modes = [
      [this.distance, this.height],
      [this.distance * 0.75, 0.45],
      [this.distance * 1.6, 2.6],
    ];
    const [d, h] = modes[this.mode];
    out.set(-Math.sin(this.heading) * d, h, -Math.cos(this.heading) * d).add(target);
    return out;
  }

  update(dt, target, velocity, opts = {}) {
    // heading follows horizontal velocity when moving
    const hs = Math.hypot(velocity.x, velocity.z);
    if (hs > 0.7 && !opts.freezeHeading) {
      const want = Math.atan2(velocity.x, velocity.z);
      let d = want - this.heading;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const rate = (opts.airborne ? 1.4 : 3.2) * Math.min(1, hs / 2.5);
      this.heading += d * (1 - Math.exp(-rate * dt));
    } else if (opts.facing !== undefined && hs <= 0.7) {
      let d = opts.facing - this.heading;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.heading += d * (1 - Math.exp(-1.2 * dt));
    }

    const focus = _v2.copy(target);
    focus.y += this.focusHeight;
    // vertical follow is softer in the air so big airs feel big
    const desired = this._desired(target, _v1);
    if (opts.airborne) desired.y = THREE.MathUtils.lerp(desired.y, this.pos.y, 0.35);

    // collision: pull the camera in front of walls
    const dir = _v3.subVectors(desired, focus);
    const len = dir.length();
    if (len > 0.01) {
      dir.divideScalar(len);
      const hit = this.collision.raycast(focus, dir, len, _hit);
      if (hit) desired.copy(focus).addScaledVector(dir, Math.max(0.4, hit.distance - 0.25));
    }
    // keep above the ground
    const g = this.collision.raycast(_v3.copy(desired).setY(desired.y + 3), new THREE.Vector3(0, -1, 0), 6, _hit);
    if (g && desired.y < g.point.y + 0.25) desired.y = g.point.y + 0.25;

    const k = 1 - Math.exp(-(opts.airborne ? 5 : 8) * dt);
    this.pos.lerp(desired, k);
    this.look.lerp(focus, 1 - Math.exp(-14 * dt));
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }

  // slow cinematic orbit for menus
  orbit(dt, center, radius = 7, height = 2.4, speed = 0.12) {
    this.heading += speed * dt;
    this.pos.set(center.x + Math.sin(this.heading) * radius, center.y + height, center.z + Math.cos(this.heading) * radius);
    this.look.copy(center).y += 0.9;
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }
}
