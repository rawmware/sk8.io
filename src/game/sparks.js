import * as THREE from 'three';

// Grind sparks: a small pool of additive points thrown off metal contact.

const MAX = 400;

export class Sparks {
  constructor(scene) {
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.next = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(
      g,
      new THREE.PointsMaterial({ size: 0.035, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }),
    );
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.acc = 0;
  }

  // rate: sparks per second; dir: travel direction of the board along the rail
  emit(dt, at, dir, speed, rate) {
    this.acc += rate * dt;
    while (this.acc >= 1) {
      this.acc -= 1;
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      this.pos[i * 3] = at.x;
      this.pos[i * 3 + 1] = at.y;
      this.pos[i * 3 + 2] = at.z;
      // thrown backward from the travel direction, fanned out and up
      const back = -(0.3 + Math.random() * 0.6) * speed;
      this.vel[i * 3] = dir.x * back + (Math.random() - 0.5) * 2.2;
      this.vel[i * 3 + 1] = Math.random() * 2.4;
      this.vel[i * 3 + 2] = dir.z * back + (Math.random() - 0.5) * 2.2;
      this.life[i] = 0.18 + Math.random() * 0.3;
    }
  }

  update(dt) {
    for (let i = 0; i < MAX; i++) {
      let l = this.life[i];
      if (l <= 0) {
        this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0;
        continue;
      }
      l -= dt;
      this.life[i] = l;
      this.vel[i * 3 + 1] -= 9.8 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const k = Math.max(0, Math.min(1, l / 0.3));
      this.col[i * 3] = 1.0 * k + 0.2;
      this.col[i * 3 + 1] = 0.55 * k * k + 0.05;
      this.col[i * 3 + 2] = 0.15 * k * k * k;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}
