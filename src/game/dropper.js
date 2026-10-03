import * as THREE from 'three';

// skate-style Object Dropper: fly a ghost of an obstacle around, rotate it, drop it into the park.

const _v = new THREE.Vector3();
const _hit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: '' };

export class Dropper {
  constructor(world, collision, scene) {
    this.world = world;
    this.collision = collision;
    this.scene = scene;
    this.active = false;
    this.index = 0;
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.ghost = null;
    this.camHeading = 0;
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
  }

  get item() {
    return this.world.catalog[this.index];
  }

  enter(origin, heading) {
    this.active = true;
    this.camHeading = heading;
    this.yaw = heading;
    this.pos.set(origin.x + Math.sin(heading) * 6, origin.y, origin.z + Math.cos(heading) * 6);
    this._ground();
    this._rebuildGhost();
    this.camPos.set(this.pos.x - Math.sin(heading) * 9, this.pos.y + 6, this.pos.z - Math.cos(heading) * 9);
  }

  exit() {
    this.active = false;
    if (this.ghost) {
      this.scene.remove(this.ghost);
      this.ghost = null;
    }
  }

  _rebuildGhost() {
    if (this.ghost) this.scene.remove(this.ghost);
    this.ghost = this.world.makeGhost(this.item.id);
    this.scene.add(this.ghost);
    this._syncGhost();
  }

  _ground() {
    const h = this.collision.raycast(_v.set(this.pos.x, this.pos.y + 25, this.pos.z), new THREE.Vector3(0, -1, 0), 60, _hit);
    if (h) this.pos.y = h.point.y;
  }

  _syncGhost() {
    if (!this.ghost) return;
    this.ghost.position.copy(this.pos);
    this.ghost.rotation.set(0, this.yaw, 0);
  }

  // returns an action string for audio/ui or null
  update(dt, inp, camera) {
    if (!this.active) return null;
    let action = null;
    const n = this.world.catalog.length;
    if (inp.selectIndex !== undefined && inp.selectIndex < n) {
      this.index = inp.selectIndex;
      this._rebuildGhost();
      action = 'select';
    }
    if (inp.cycle) {
      this.index = (((this.index + Math.sign(inp.cycle)) % n) + n) % n;
      this._rebuildGhost();
      action = 'select';
    }
    if (inp.rotate) this.yaw += (inp.rotate * Math.PI) / 12;
    // continuous rotation with the steer axis while holding brake/push is awkward; use Q/E or bumpers.
    const sp = 7 * dt;
    const mx = inp.move.x;
    const my = inp.move.y;
    if (mx || my) {
      const h = this.camHeading;
      // forward = camera heading, right = -X rotated
      this.pos.x += (Math.sin(h) * my - Math.cos(h) * mx) * sp;
      this.pos.z += (Math.cos(h) * my + Math.sin(h) * mx) * sp;
      this._ground();
    }
    // mouse: horizontal mouse motion orbits the camera around the ghost
    if (inp.flick && Math.abs(inp.flick.x) > 0.05) this.camHeading -= inp.flick.x * 2.2 * dt;
    this._syncGhost();

    if (inp.place) {
      this.world.placeObject(this.item.id, this.pos.clone(), this.yaw);
      action = 'place';
    }
    if (inp.remove) {
      let best = null;
      let bd = 4;
      for (const h of this.world.placed) {
        const p = h.group ? h.group.position : h.position;
        if (!p) continue;
        const d = p.distanceTo(this.pos);
        if (d < bd) {
          bd = d;
          best = h;
        }
      }
      if (best) {
        this.world.removeObject(best);
        action = 'remove';
      }
    }

    // camera: high three-quarter view behind the ghost
    const h = this.camHeading;
    const want = _v.set(this.pos.x - Math.sin(h) * 9, this.pos.y + 6.5, this.pos.z - Math.cos(h) * 9);
    this.camPos.lerp(want, 1 - Math.exp(-6 * dt));
    this.camLook.lerp(this.pos, 1 - Math.exp(-10 * dt));
    camera.position.copy(this.camPos);
    camera.lookAt(this.camLook);
    return action;
  }
}
