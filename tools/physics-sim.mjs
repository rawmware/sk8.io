// Headless physics sanity checks for the skater controller (node tools/physics-sim.mjs)
import * as THREE from 'three';
import { CollisionWorld } from '../src/game/collision.js';
import { SkaterController } from '../src/game/controller.js';

function quarterPipe(R, width, x0) {
  // riding surface rising toward +Z starting at z = x0
  const segs = 28;
  const pos = [];
  const idx = [];
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * (Math.PI / 2) * 0.97;
    const z = x0 + Math.sin(a) * R;
    const y = R - Math.cos(a) * R;
    pos.push(-width / 2, y, z, width / 2, y, z);
  }
  for (let i = 0; i < segs; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const m = new THREE.Mesh(g);
  m.userData.surface = 'wood';
  return m;
}

const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2));
ground.userData.surface = 'smoothConcrete';
const qp = quarterPipe(2.5, 8, 30);
const ledge = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.45, 6));
ledge.position.set(5, 0.225, 10);
ledge.userData.surface = 'concrete';

const cw = new CollisionWorld();
cw.setStatic([ground, qp, ledge]);

const ctl = new SkaterController(cw);
ctl.rails = [{ a: new THREE.Vector3(-5, 0.6, 6), b: new THREE.Vector3(-5, 0.6, 16), kind: 'metal', radius: 0.02 }];

const blank = () => ({ steer: 0, forward: 0, push: false, brake: false, flick: { x: 0, y: 0 }, flickSource: 'pad', ollie: false, manual: false, noseManual: false, grabToe: false, grabHeel: false, nose: false, tail: false });
const DT = 1 / 120;
let log = [];
function run(seconds, inputFn) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    const inp = blank();
    inputFn?.(inp, i * DT);
    ctl.step(DT, inp);
    for (const e of ctl.events) log.push(`${ctl.time.toFixed(2)} ${e.type} ${e.text || e.reason || ''}`);
    ctl.events.length = 0;
  }
}
const st = (label) =>
  console.log(label.padEnd(26), 'mode', ctl.mode.padEnd(6), 'pos', ctl.pos.toArray().map((v) => v.toFixed(2)).join(','), 'speed', ctl.speed.toFixed(2), 'along', ctl.along.toFixed(2));

// flick stick paths (pad coords: x right+, y up+). regular stance: heel side = screen left (x<0)
function flickPath(points, dur) {
  return (inp, t) => {
    const k = Math.min(points.length - 1, (t / dur) * (points.length - 1));
    const i = Math.floor(k);
    const f = k - i;
    const a = points[i], b = points[Math.min(points.length - 1, i + 1)];
    inp.flick.x = a[0] + (b[0] - a[0]) * f;
    inp.flick.y = a[1] + (b[1] - a[1]) * f;
  };
}

ctl.teleport(new THREE.Vector3(0, 0, 0), 0);
run(0.5);
st('settled');
run(3, (i) => (i.push = true));
st('after 3s pushing');
run(1.5, (i) => (i.steer = 1));
st('carving left 1.5s');
run(1.0, (i) => (i.steer = -1));
st('carving right 1s');

// ollie
ctl.teleport(new THREE.Vector3(0, 0, 0), 0);
run(2, (i) => (i.push = true));
let maxY = 0;
const hold = flickPath([[0, 0], [0, -1], [0, -1], [0, -1]], 0.15);
run(0.15, hold);
run(0.06, flickPath([[0, -1], [0, 0], [0, 1]], 0.06));
for (let k = 0; k < 120; k++) {
  run(DT);
  maxY = Math.max(maxY, ctl.pos.y);
}
st('ollie');
console.log('  ollie apex', maxY.toFixed(2));

// kickflip (regular: down then up-left)
run(0.5);
run(0.15, flickPath([[0, 0], [0, -1], [0, -1]], 0.15));
run(0.07, flickPath([[0, -1], [-0.4, 0.3], [-0.75, 0.66]], 0.07));
run(1.2);
st('kickflip');

// varial kickflip: down, around the heel side (left), up-left
run(0.4);
run(0.12, flickPath([[0, 0], [0, -1], [0, -1]], 0.12));
run(0.12, flickPath([[0, -1], [-0.7, -0.7], [-1, 0], [-0.8, 0.6]], 0.12));
run(1.2);
st('varial kickflip');

// tre flip: down, heel side, up, past the top
run(0.4);
run(0.12, flickPath([[0, 0], [0, -1], [0, -1]], 0.12));
run(0.16, flickPath([[0, -1], [-0.7, -0.7], [-1, 0], [-0.7, 0.7], [0, 1], [0.6, 0.8]], 0.16));
run(1.2);
st('tre');

// pop shove: down then left, hold
run(0.4);
run(0.12, flickPath([[0, 0], [0, -1], [0, -1]], 0.12));
run(0.25, flickPath([[0, -1], [-0.7, -0.7], [-1, 0], [-1, 0], [-1, 0]], 0.25));
run(1.2);
st('pop shove');

// quarter pipe: ride straight at it
ctl.teleport(new THREE.Vector3(0, 0, 10), 0);
run(3, (i) => (i.push = true));
let maxQ = 0;
for (let k = 0; k < 600; k++) {
  run(DT);
  maxQ = Math.max(maxQ, ctl.pos.y);
}
st('quarter pipe');
console.log('  qp apex', maxQ.toFixed(2));

// grind: approach rail along +Z and ollie onto it
ctl.teleport(new THREE.Vector3(-5.05, 0, 2), 0);
run(2, (i) => (i.push = true));
run(0.12, flickPath([[0, 0], [0, -1], [0, -1]], 0.12));
run(0.06, flickPath([[0, -1], [0, 0], [0, 1]], 0.06));
let grindSeen = false;
for (let k = 0; k < 360; k++) {
  run(DT);
  if (ctl.mode === 'grind') grindSeen = true;
}
st('grind attempt');
console.log('  grind seen', grindSeen);

// wall: ride into ledge side
ctl.teleport(new THREE.Vector3(2, 0, 10), Math.PI / 2);
for (let k = 0; k < 300; k++) {
  run(DT, (i) => (i.push = true));
  if (ctl.pos.x > 4 && ctl.pos.x < 6.5 && k % 3 == 0) st('  trace ' + k);
}
st('ledge side');

console.log('\nEVENTS:\n' + log.filter((l) => !l.includes('push')).join('\n'));
