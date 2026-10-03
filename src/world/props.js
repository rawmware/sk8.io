// Knockable dynamic props (traffic cones, trash cans) with a tiny tip-over physics model.
import * as THREE from 'three';
import { mergeGeos } from './builder.js';
import { trafficConeGeometry, trashCanGeometry } from './pieces.js';
import { GRAVITY } from '../core/constants.js';

const KINDS = {
  cone: { radius: 0.2, height: 0.7, baseR: 0.19, comH: 0.24, mass: 2.0, rollR: 0.12, mu: 0.55, muLying: 0.35 },
  trash: { radius: 0.3, height: 0.95, baseR: 0.27, comH: 0.42, mass: 11.0, rollR: 0.28, mu: 0.6, muLying: 0.09 },
};

let geoCache = null;
function geos() {
  if (!geoCache) {
    geoCache = {
      cone: mergeGeos(trafficConeGeometry(), ['position', 'normal', 'uv', 'color']),
      trash: mergeGeos(trashCanGeometry(), ['position', 'normal', 'uv', 'color']),
    };
    for (const g of Object.values(geoCache)) g.computeVertexNormals();
  }
  return geoCache;
}

const UP = new THREE.Vector3(0, 1, 0);
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();

export function createProp(kind, M, position, yaw = Math.random() * Math.PI * 2) {
  const K = KINDS[kind];
  const mesh = new THREE.Mesh(geos()[kind], M.vertexColor);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const obj = new THREE.Group();
  obj.name = 'prop:' + kind;
  obj.add(mesh);
  obj.position.copy(position);
  obj.rotation.y = yaw;
  const prop = {
    kind,
    object3d: obj,
    radius: K.radius,
    height: K.height,
    mass: K.mass,
    velocity: new THREE.Vector3(),
    angularVelocity: new THREE.Vector3(),
    groundY: position.y,
    home: position.clone(),
    homeYaw: yaw,
    // internal tip-over state
    tilt: 0,
    tiltRate: 0,
    fallDir: new THREE.Vector3(1, 0, 0),
    spin: yaw,
    spinRate: 0,
    sleeping: true,
  };
  return prop;
}

export function kickProp(prop, impulse) {
  const K = KINDS[prop.kind];
  prop.velocity.addScaledVector(impulse, 1 / prop.mass);
  const h = Math.hypot(impulse.x, impulse.z);
  if (h > 1e-4) {
    const dir = _v.set(impulse.x / h, 0, impulse.z / h);
    if (prop.tilt < 0.05) prop.fallDir.copy(dir);
    const dv = h / prop.mass;
    prop.tiltRate += dv * (1.8 / (K.comH * 4));
    prop.velocity.y += Math.min(2.5, dv * 0.22);
    prop.spinRate += (Math.random() - 0.5) * dv * 3;
  }
  prop.sleeping = false;
}

export function resetProp(prop) {
  prop.object3d.position.copy(prop.home);
  prop.velocity.set(0, 0, 0);
  prop.tilt = 0;
  prop.tiltRate = 0;
  prop.spin = prop.homeYaw;
  prop.spinRate = 0;
  prop.sleeping = true;
  applyPose(prop);
}

function applyPose(prop) {
  const axis = _v.crossVectors(UP, prop.fallDir);
  if (axis.lengthSq() < 1e-8) axis.set(1, 0, 0);
  axis.normalize();
  _q1.setFromAxisAngle(axis, prop.tilt);
  _q2.setFromAxisAngle(UP, prop.spin);
  prop.object3d.quaternion.multiplyQuaternions(_q1, _q2);
  prop.angularVelocity.copy(axis).multiplyScalar(prop.tiltRate);
  prop.angularVelocity.y += prop.spinRate;
}

export function updateProps(props, dt, bound = 84.6) {
  const h = Math.min(dt, 1 / 30);
  for (const p of props) {
    if (p.sleeping && p.velocity.lengthSq() < 1e-6) continue;
    p.sleeping = false;
    const K = KINDS[p.kind];
    const pos = p.object3d.position;
    const v = p.velocity;
    v.y -= GRAVITY * h;
    pos.addScaledVector(v, h);
    // tilt dynamics (inverted pendulum around the base rim)
    const thC = Math.atan2(K.baseR, K.comH);
    if (p.tilt > 0 || p.tiltRate > 0) {
      p.tiltRate += 16 * Math.sin(p.tilt - thC) * h;
      p.tiltRate *= Math.exp(-1.2 * h);
      p.tilt += p.tiltRate * h;
      if (p.tilt >= Math.PI / 2) {
        p.tilt = Math.PI / 2;
        p.tiltRate = p.tiltRate > 0.6 ? -p.tiltRate * 0.18 : 0;
      }
      if (p.tilt <= 0) {
        p.tilt = 0;
        p.tiltRate = p.tiltRate < -0.6 ? -p.tiltRate * 0.2 : 0;
      }
    }
    const lying = p.tilt > 1.4;
    const floorY = p.groundY + K.baseR * Math.sin(p.tilt) * (p.kind === 'cone' ? 0.6 : 1);
    let grounded = false;
    if (pos.y <= floorY) {
      pos.y = floorY;
      if (v.y < 0) v.y = v.y < -1.2 ? -v.y * 0.25 : 0;
      grounded = true;
    }
    if (grounded) {
      const sp = Math.hypot(v.x, v.z);
      if (sp > 1e-5) {
        const mu = lying ? K.muLying : K.mu;
        const ns = Math.max(0, sp - mu * GRAVITY * h);
        v.x *= ns / sp;
        v.z *= ns / sp;
        if (lying) {
          // roll around the long axis when moving sideways
          const side = _v.crossVectors(UP, p.fallDir).normalize();
          p.spin += ((v.x * side.x + v.z * side.z) / K.rollR) * h * (p.kind === 'cone' ? 0.5 : 1);
        }
      }
      p.spinRate *= Math.exp(-4 * h);
    }
    p.spin += p.spinRate * h;
    // keep inside the park
    if (Math.abs(pos.x) > bound) {
      pos.x = Math.sign(pos.x) * bound;
      v.x *= -0.3;
    }
    if (Math.abs(pos.z) > bound) {
      pos.z = Math.sign(pos.z) * bound;
      v.z *= -0.3;
    }
    applyPose(p);
    if (grounded && v.lengthSq() < 0.0004 && Math.abs(p.tiltRate) < 0.02 && (p.tilt === 0 || p.tilt >= Math.PI / 2 - 1e-3) && Math.abs(p.spinRate) < 0.05) {
      v.set(0, 0, 0);
      p.tiltRate = 0;
      p.spinRate = 0;
      p.sleeping = true;
    }
  }
}
