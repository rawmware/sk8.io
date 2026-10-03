// Flip-in grind combos: pop a flip trick next to a ledge/rail, catch it, lock in with a stick direction.
// node tools/combo-sim.mjs
import * as THREE from 'three';
import { CollisionWorld } from '../src/game/collision.js';
import { SkaterController } from '../src/game/controller.js';

const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2));
ground.userData.surface = 'concrete';
const cw = new CollisionWorld();
cw.setStatic([ground]);
const ctl = new SkaterController(cw);
// a waist-high flat rail along +Z at x = 0.6
ctl.rails = [{ a: new THREE.Vector3(0.6, 0.42, 1.2), b: new THREE.Vector3(0.6, 0.42, 30), kind: 'metal', radius: 0.02 }];
const DT = 1 / 120;
const base = () => ({ steer: 0, flick: { x: 0, y: 0 }, flickSource: 'mouse', flickHold: false, flickPress: false, flickRelease: false, catch: false, nose: false, tail: false });

function combo(label, { path, catchAt, lockInput, spinTo = 0 }) {
  ctl.teleport(new THREE.Vector3(0, 0, 0), 0);
  ctl.vel.set(1.6, 0, 5); // drifting toward the rail while rolling along it
  const ev = [];
  const tick = (m) => {
    ctl.step(DT, { ...base(), ...m });
    for (const e of ctl.events) if (e.type === 'trick' || e.type === 'bail' || e.type === 'catch') ev.push(e.type === 'trick' ? `"${e.text}"(${e.quality})` : e.type + ':' + (e.reason || e.quality));
    ctl.events.length = 0;
  };
  tick({ flickHold: true, flickPress: true });
  for (const p of path) for (let j = 0; j < 3; j++) tick({ flickHold: true, flick: { x: p[0], y: p[1] } });
  tick({ flickRelease: true });
  const t0 = ctl.time;
  let caught = false;
  let gname = "";
  for (let n = 0; n < 1400; n++) {
    if (ctl.mode === "grind") gname = ctl.grindName;
    const dt = ctl.time - t0;
    const spinning = spinTo && ctl.mode === 'air' && Math.abs(ctl.spinTotal) < spinTo;
    const m = spinning ? { steer: 1 } : { ...lockInput };
    if (!caught && catchAt != null && dt >= catchAt) {
      m.catch = true;
      caught = true;
    }
    tick(m);
    if (ctl.mode === 'ground' && n > 30) break;
  }
  console.log(label.padEnd(26), "rail:", JSON.stringify(gname), "|", ev.join(" | "));
}

const KICKFLIP = [[0, -1], [0, -1], [-0.3, 0], [-0.7, 0.7]];
const TRE = [[0, -1], [0, -1], [-0.7, -0.7], [-1, 0], [-0.7, 0.7], [0, 1], [0.6, 0.8]];
const HARDFLIP_NOLLIE = [[0, 1], [0, 1], [0.7, 0.7], [1, 0], [0.3, -0.3], [-0.7, -0.7]];
combo('tre flip smith grind', { path: TRE, catchAt: 0.44, lockInput: { tail: true, steer: -1 } });
combo('kickflip bluntslide', { path: KICKFLIP, catchAt: 0.33, lockInput: { tail: true, steer: 1 }, spinTo: Math.PI / 2 });
combo('nollie hardflip 5-0', { path: HARDFLIP_NOLLIE, catchAt: 0.39, lockInput: { tail: true } });
combo('kickflip 50-50', { path: KICKFLIP, catchAt: 0.33, lockInput: {} });
combo('uncaught into rail', { path: TRE, catchAt: null, lockInput: {} });
