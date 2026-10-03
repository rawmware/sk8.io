import test from 'node:test';
import assert from 'node:assert/strict';
import { SkatePhysics, terrainHeight, makeObstacles } from '../src/physics.js';

function advance(p, seconds, input = {}) { for (let t = 0; t < seconds; t += 1 / 120) p.step(1 / 120, input); }
test('pushing accelerates, coasting preserves momentum, braking slows the board', () => {
  const p = new SkatePhysics([]); advance(p, 2, { push: true }); assert.ok(p.speed > 4 && p.speed < 12);
  const speed = p.speed; advance(p, .5); assert.ok(p.speed > speed * .8 && p.speed < speed);
  advance(p, 1, { brake: true }); assert.ok(p.speed < 1);
});
test('charged ollies rise and land, then bank points after the line window', () => {
  const p = new SkatePhysics([]); advance(p, .6, { charge: true }); advance(p, .22);
  assert.equal(p.grounded, false); assert.ok(p.y > .5);
  advance(p, 1.5); assert.equal(p.grounded, true); assert.equal(p.landed, 1); assert.ok(p.combo > 0);
  advance(p, 3.1); assert.ok(p.total >= 100); assert.equal(p.combo, 0);
});
test('full pop gives enough airtime for a kickflip and awards it once', () => {
  const p = new SkatePhysics([]); p.pop(1); p.trick('kickflip'); advance(p, 1);
  assert.equal(p.bailTime, 0); assert.equal(p.landed, 1);
  assert.ok(p.events.some(e => e.type === 'score' && e.name === 'Kickflip')); assert.ok(p.combo >= 350);
});
test('a late unfinished flip bails and loses an unbanked line', () => {
  const p = new SkatePhysics([]); p.score('Manual', 200); p.pop(1); advance(p, .62); p.trick('kickflip'); advance(p, .2);
  assert.ok(p.bailTime > 0); assert.equal(p.combo, 0); assert.equal(p.total, 0);
});
test('bowl surface is below ground and continuous at its rim', () => {
  assert.equal(terrainHeight(-18, 13), -2.5); assert.equal(terrainHeight(-8, 13), 0);
  assert.ok(Math.abs(terrainHeight(-8.001, 13)) < .001);
});
test('ramp is rideable and a ledge requires an ollie', () => {
  const p = new SkatePhysics(makeObstacles()); p.x = 7; p.z = -13; p.vz = 4;
  advance(p, .4); assert.ok(p.bailTime > 0);
  assert.ok(terrainHeight(18, -5, p.obstacles) > 1);
});
test('descending aligned board locks onto rail, exits and scores a grind', () => {
  const rail = { id: 'test', type: 'rail', x: 0, z: 0, yaw: 0, length: 5, height: .52 };
  const p = new SkatePhysics([rail]); p.x = 0; p.z = -1; p.y = .7; p.vz = 4; p.vy = -1; p.grounded = false;
  advance(p, .15, { grind: true }); assert.equal(p.rail, rail);
  advance(p, 1.2, { grind: true }); assert.equal(p.rail, null); assert.ok(p.grinds >= 1);
  assert.ok(p.events.some(e => e.type === 'score' && e.name === '50–50 grind'));
});
test('fixed integration produces equivalent motion at different render rates', () => {
  const simulate = fps => { const p = new SkatePhysics([]); let acc = 0; for (let frame = 0; frame < fps * 2; frame++) { acc += 1 / fps; while (acc >= 1 / 120 - 1e-10) { p.step(1 / 120, { push: true, steer: .3 }); acc -= 1 / 120; } } return p; };
  const a = simulate(30), b = simulate(144); assert.ok(Math.abs(a.x - b.x) < 1e-6); assert.ok(Math.abs(a.z - b.z) < 1e-6);
});
