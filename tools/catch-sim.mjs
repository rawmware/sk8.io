// Headless checks for the mouse hold -> flick -> release -> click-to-catch flow (node tools/catch-sim.mjs)
import * as THREE from 'three';
import { CollisionWorld } from '../src/game/collision.js';
import { SkaterController } from '../src/game/controller.js';

const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2));
ground.userData.surface = 'smoothConcrete';
const cw = new CollisionWorld();
cw.setStatic([ground]);
const ctl = new SkaterController(cw);
const DT = 1 / 120;
const base = () => ({ steer: 0, flick: { x: 0, y: 0 }, flickSource: 'mouse', flickHold: false, flickPress: false, flickRelease: false, catch: false });

function attempt(label, path, catchAfter) {
  ctl.teleport(new THREE.Vector3(0, 0, 0), 0);
  ctl.vel.set(0, 0, 4);
  const events = [];
  const tick = (mod) => {
    const i = { ...base(), ...mod };
    ctl.step(DT, i);
    for (const e of ctl.events) events.push(e.type + (e.text ? ':' + e.text : '') + (e.reason ? ':' + e.reason : '') + (e.quality && e.type === 'catch' ? ':' + e.quality : ''));
    ctl.events.length = 0;
  };
  tick({ flickHold: true, flickPress: true });
  // draw the gesture while holding
  for (let k = 0; k < path.length; k++) for (let j = 0; j < 3; j++) tick({ flickHold: true, flick: { x: path[k][0], y: path[k][1] } });
  tick({ flickRelease: true, flick: { x: 0, y: 0 } });
  const popAt = ctl.time;
  let caught = catchAfter == null;
  for (let n = 0; n < 240; n++) {
    const doCatch = !caught && ctl.time - popAt >= catchAfter;
    if (doCatch) caught = true;
    tick({ catch: doCatch });
    if (ctl.mode === 'ground' && n > 20) break;
  }
  console.log(label.padEnd(30), events.filter((e) => e !== 'push').join(' | '));
}

const KF = [[0, -0.5], [0, -1], [0, -1], [-0.3, 0], [-0.7, 0.7]];
attempt('ollie (no catch needed)', [[0, -1], [0, -1], [0, 0], [0, 1]], null);
attempt('kickflip caught on time', KF, 0.34);
attempt('kickflip caught slightly early', KF, 0.26);
attempt('kickflip caught late-ish', KF, 0.47);
attempt('kickflip caught way early', KF, 0.17);
attempt('kickflip never caught', KF, null);
attempt('double kickflip (catch 2T)', KF, 0.68);
attempt('varial kickflip', [[0, -1], [0, -1], [-0.7, -0.7], [-1, 0], [-0.8, 0.6]], 0.4);
attempt('pop shove-it', [[0, -1], [0, -1], [-0.7, -0.7], [-1, 0], [-1, 0]], 0.32);
attempt('released while still loaded', [[0, -1], [0, -1]], null);
