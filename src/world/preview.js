// Standalone world preview: orbit camera, preset shots (?shot=N), and a self-check (window.__check()).
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createWorld } from './index.js';
import { SURFACES } from '../core/constants.js';

const params = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = +(params.get('exposure') || 1.0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 3000);
const world = createWorld(renderer, scene);
window.world = world;

const SHOTS = [
  { name: 'overview', pos: [95, 70, -110], target: [-5, 0, -5] },
  { name: 'plaza eye', pos: [6, 1.7, -14], target: [-20, 1, 6] },
  { name: 'stairs+hubba', pos: [-14, 2.2, 1], target: [-26, 1, 7] },
  { name: 'mini+vert', pos: [2, 6, -38], target: [10, 1, -62] },
  { name: 'bowl', pos: [-38, 5, -48], target: [-53, -2, -59] },
  { name: 'hill down', pos: [-82, 7, 69], target: [0, 0, 69] },
  { name: 'hill up', pos: [30, 3, 69], target: [-60, 3, 69] },
  { name: 'big bank', pos: [45, 4, 60], target: [80, 1, 72] },
  { name: 'west qp + funbox', pos: [-45, 5, 30], target: [-75, 0, 10] },
  { name: 'mural west', pos: [-60, 6, -5], target: [-101, 5, -6] },
  { name: 'top down', pos: [0, 260, 1], target: [0, 0, 0] },
  { name: 'vert close', pos: [24, 1.6, -52], target: [24, 2, -64] },
  { name: 'east', pos: [30, 5, -5], target: [80, 1, 0] },
  { name: 'south qps', pos: [0, 4, -60], target: [20, 0, -84] },
];
const shotIdx = params.has('shot') ? +params.get('shot') : 0;
function applyShot(i) {
  const s = SHOTS[((i % SHOTS.length) + SHOTS.length) % SHOTS.length];
  camera.position.set(...s.pos);
  controls.target.set(...s.target);
  controls.update();
}
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
applyShot(shotIdx);
window.applyShot = applyShot;
window.SHOTS = SHOTS;
addEventListener('keydown', (e) => {
  const n = parseInt(e.key, 10);
  if (!Number.isNaN(n)) applyShot(n);
});

if (params.has('colliders')) {
  const wm = new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true, transparent: true, opacity: 0.25 });
  for (const c of world.colliders) {
    const m = new THREE.Mesh(c.geometry, wm);
    m.matrixAutoUpdate = false;
    m.matrix.copy(c.matrixWorld);
    scene.add(m);
  }
}
if (params.has('rails')) {
  const pts = [];
  for (const r of world.rails) pts.push(r.a, r.b);
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  const colors = { metal: 0x00ffff, coping: 0xff3300, concrete: 0xffff00, wood: 0x33ff33 };
  const col = [];
  for (const r of world.rails) {
    const c = new THREE.Color(colors[r.kind] || 0xffffff);
    col.push(c.r, c.g, c.b, c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const ls = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false }));
  ls.renderOrder = 999;
  scene.add(ls);
}
if (params.has('drop')) {
  // place every catalog object in a row on the plaza (dropper test)
  let x = -20;
  for (const c of world.catalog) {
    world.placeObject(c.id, new THREE.Vector3(x, 0, 52), 0);
    x += 4;
  }
  const ser = world.serialize();
  world.deserialize(ser);
}

const hud = document.getElementById('hud');
const clock = new THREE.Clock();
let frames = 0;
let fpsT = 0;
let fps = 0;
const focus = new THREE.Vector3();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  controls.update();
  focus.copy(controls.target);
  world.update(dt, focus, camera);
  renderer.render(scene, camera);
  frames++;
  fpsT += dt;
  if (fpsT > 0.5) {
    fps = frames / fpsT;
    frames = 0;
    fpsT = 0;
  }
  const info = renderer.info;
  hud.textContent = `shot ${shotIdx} ${SHOTS[shotIdx % SHOTS.length].name}  fps ${fps.toFixed(0)}\ncalls ${info.render.calls}  tris ${info.render.triangles}\n` +
    `colliders ${world.stats.colliderTriangles} tris / ${world.stats.colliderMeshes} meshes  rails ${world.stats.rails}\nbuild ${world.stats.buildMs}ms (tex ${world.stats.textureMs}ms)`;
  window.__frames = (window.__frames || 0) + 1;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------------- self check ----------------
window.__check = function () {
  const report = { errors: [], warnings: [] };
  let tris = 0;
  for (const c of world.colliders) {
    if (!SURFACES.includes(c.userData.surface)) report.errors.push(`collider ${c.name} bad surface ${c.userData.surface}`);
    const p = c.geometry.attributes.position.array;
    for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i])) { report.errors.push(`NaN in collider ${c.name}`); break; }
    tris += (c.geometry.index ? c.geometry.index.count : c.geometry.attributes.position.count) / 3;
  }
  report.colliderTriangles = tris;
  scene.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    for (const k of ['position', 'normal', 'uv']) {
      const a = o.geometry.attributes[k];
      if (!a) continue;
      const arr = a.array;
      for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) { report.errors.push(`NaN in ${o.name} ${k}`); break; }
    }
  });
  let shortRails = 0;
  const kinds = {};
  for (const r of world.rails) {
    if (!(r.a.distanceTo(r.b) > 0.01)) shortRails++;
    if (![r.a.x, r.a.y, r.a.z, r.b.x, r.b.y, r.b.z].every(Number.isFinite)) report.errors.push('NaN rail');
    kinds[r.kind] = (kinds[r.kind] || 0) + 1;
  }
  if (shortRails) report.errors.push(`${shortRails} zero-length rails`);
  report.rails = world.rails.length;
  report.railKinds = kinds;
  // raycasts
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const cast = (x, y, z, dir = down) => {
    ray.set(new THREE.Vector3(x, y, z), dir);
    ray.far = 50;
    const h = ray.intersectObjects(world.colliders, false);
    return h[0] || null;
  };
  const sp = world.spawn.position;
  const hs = cast(sp.x, sp.y + 5, sp.z);
  report.spawnHit = hs ? { y: +hs.point.y.toFixed(3), surface: hs.object.userData.surface } : null;
  if (!hs) report.errors.push('spawn raycast miss');
  report.spots = world.spots.map((s) => {
    const h = cast(s.position.x, s.position.y + 3, s.position.z);
    const ok = h && Math.abs(h.point.y - s.position.y) < 0.15;
    if (!ok) report.errors.push(`spot ${s.name} surface mismatch (${h ? h.point.y.toFixed(2) : 'miss'} vs ${s.position.y})`);
    return `${s.name}:${h ? h.point.y.toFixed(2) + '/' + h.object.userData.surface : 'MISS'}`;
  });
  // sweep across transition areas: a grid of down rays must always hit, and adjacent heights must not jump
  const regions = [
    { name: 'mini', x0: -30, x1: -14, z0: -62, z1: -58, axis: 'x' },
    { name: 'vert', x0: 14, x1: 34, z0: -64, z1: -56, axis: 'x' },
    { name: 'spine', x0: 44, x1: 56, z0: -64, z1: -60, axis: 'x' },
    { name: 'bowl', x0: -64, x1: -40, z0: -59, z1: -57, axis: 'x' },
    { name: 'bowlZ', x0: -53, x1: -51, z0: -68, z1: -48, axis: 'z' },
    { name: 'westQP', x0: -85, x1: -70, z0: -20, z1: 40, axis: 'x' },
    { name: 'eastQP', x0: 70, x1: 85, z0: -25, z1: 30, axis: 'x' },
    { name: 'southQP', x0: -30, x1: 80, z0: -85, z1: -75, axis: 'z' },
    { name: 'hill', x0: -84, x1: 30, z0: 66, z1: 72, axis: 'x' },
    { name: 'bigbank', x0: 60, x1: 84.5, z0: 65, z1: 80, axis: 'x' },
    { name: 'funbox', x0: -70, x1: -54, z0: 19, z1: 21, axis: 'x' },
    { name: 'stairbank', x0: -32, x1: -30, z0: -14, z1: 0, axis: 'z' },
  ];
  report.sweeps = {};
  for (const R of regions) {
    let miss = 0;
    let maxJump = 0;
    let n = 0;
    const step = 0.05;
    const lines = 3;
    for (let l = 0; l < lines; l++) {
      let prev = null;
      if (R.axis === 'x') {
        const z = R.z0 + ((R.z1 - R.z0) * (l + 0.5)) / lines;
        for (let x = R.x0; x <= R.x1; x += step) {
          const h = cast(x, 12, z);
          n++;
          if (!h) { miss++; prev = null; continue; }
          if (prev !== null) maxJump = Math.max(maxJump, Math.abs(h.point.y - prev));
          prev = h.point.y;
        }
      } else {
        const x = R.x0 + ((R.x1 - R.x0) * (l + 0.5)) / lines;
        for (let z = R.z0; z <= R.z1; z += step) {
          const h = cast(x, 12, z);
          n++;
          if (!h) { miss++; prev = null; continue; }
          if (prev !== null) maxJump = Math.max(maxJump, Math.abs(h.point.y - prev));
          prev = h.point.y;
        }
      }
    }
    report.sweeps[R.name] = { samples: n, miss, maxJump: +maxJump.toFixed(3) };
    if (miss) report.errors.push(`${R.name}: ${miss} raycast misses`);
  }
  // normal-direction raycasts on the vert wall (ray along -normal from inside the ramp's air space)
  const hv = cast(24 + 2.5 + 3.15 - 0.6, 3.3, -60, new THREE.Vector3(1, 0, 0));
  report.vertWallHit = hv ? +hv.point.x.toFixed(3) : null;
  report.drawCallsLastFrame = renderer.info.render.calls;
  report.trianglesLastFrame = renderer.info.render.triangles;
  report.stats = world.stats;
  return report;
};
