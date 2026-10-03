import * as THREE from 'three';
import { baseHeight, obstacleHeight } from './physics.js';

const material = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: .8, ...extra });
function mesh(geometry, mat, parent, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geometry, mat); m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
function box(parent, size, position, mat) { return mesh(new THREE.BoxGeometry(...size), mat, parent, ...position); }
function cylinderBetween(parent, a, b, radius, mat, sides = 12) {
  const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), delta = end.clone().sub(start);
  const m = mesh(new THREE.CylinderGeometry(radius, radius, delta.length(), sides), mat, parent);
  m.position.copy(start.add(end).multiplyScalar(.5)); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()); return m;
}
function canvasTexture(width, height, paint) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  paint(canvas.getContext('2d'), width, height);
  const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function random(seed = 7631) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }
function concreteTexture() {
  const r = random();
  const tex = canvasTexture(512, 512, (c, w, h) => {
    c.fillStyle = '#bfc3bd'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 40000; i++) { const v = 100 + r() * 110; c.fillStyle = `rgba(${v},${v},${v},${r() * .18})`; c.fillRect(r() * w, r() * h, r() * 2 + .3, r() * 2 + .3); }
    c.strokeStyle = '#9fa69f'; c.lineWidth = 1; c.strokeRect(0, 0, w, h);
    c.strokeStyle = '#adb3ad'; c.beginPath(); c.moveTo(380, 0); c.lineTo(376, 16); c.lineTo(382, 34); c.stroke();
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(18, 20); tex.anisotropy = 8; return tex;
}
function floorLabel(scene, text, x, z, width, height, color = '#e9eadf') {
  const tex = canvasTexture(1024, 256, (c, w, h) => {
    c.fillStyle = color; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = '900 145px Arial'; c.fillText(text, w / 2, h / 2);
  });
  const m = mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: .85 }), scene, x, .017, z);
  m.rotation.x = -Math.PI / 2; m.receiveShadow = false; m.castShadow = false; return m;
}

export class ParkWorld {
  constructor(container, obstacles, settings) {
    this.settings = settings; this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#b5d2d4'); this.scene.fog = new THREE.Fog('#b5d2d4', 65, 190);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, settings.quality === 'low' ? 1 : 1.75));
    this.renderer.shadowMap.enabled = settings.quality !== 'low'; this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace; this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.25;
    container.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(57, 1, .05, 240);
    this.camera.position.set(10, 9, -30); this.look = new THREE.Vector3(0, 0, -5);
    const hemi = new THREE.HemisphereLight('#dcf0ff', '#6b7157', 2.4); this.scene.add(hemi); this.hemi = hemi;
    const sun = new THREE.DirectionalLight('#fff2ce', 3.5); sun.position.set(-22, 40, -18); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -50, right: 50, top: 55, bottom: -55, near: .5, far: 120 });
    sun.shadow.normalBias = .035; sun.shadow.bias = -.0001; this.scene.add(sun); this.sun = sun;
    this.concrete = material('#e0e0d2', { map: concreteTexture() });
    this.dark = material('#283e3d', { metalness: .35, roughness: .43 });
    this.yellow = material('#eac347'); this.terracotta = material('#c75c37'); this.steel = material('#949d9a', { metalness: .8, roughness: .3 });
    this.obstacleMeshes = new Map(); this.buildTerrain(); this.buildSurroundings();
    obstacles.forEach(o => this.addObstacle(o)); this.buildBoard();
    this.wheelRotation = 0; this.cameraYaw = 0; this.cameraMode = 0; this.time = 0;
    this.resize(); window.addEventListener('resize', () => this.resize()); this.applySettings(settings);
  }
  resize() {
    this.renderer.setSize(innerWidth, innerHeight); this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
  }
  buildTerrain() {
    const geo = new THREE.PlaneGeometry(68, 78, 170, 195); geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, colors = [];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), h = baseHeight(x, z); pos.setY(i, h);
      const c = new THREE.Color(h < -.3 ? '#acc9c2' : '#ffffff'); colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geo.computeVertexNormals();
    const groundMat = this.concrete.clone(); groundMat.vertexColors = true;
    mesh(geo, groundMat, this.scene).castShadow = false;
    const coping = mesh(new THREE.TorusGeometry(10, .055, 8, 128), this.steel, this.scene, -18, .035, 13); coping.rotation.x = Math.PI / 2;
    const bowlStripe = mesh(new THREE.RingGeometry(10.1, 10.35, 128), material('#d98c5c'), this.scene, -18, .02, 13); bowlStripe.rotation.x = -Math.PI / 2;
    floorLabel(this.scene, 'sk8.io', -18, -14, 9, 2.3, '#607c72');
    floorLabel(this.scene, 'HARBOR', 16, -24, 10, 2.3, '#89958a');
    floorLabel(this.scene, '01  /  FREE SKATE', 0, -28, 8, 1.7, '#6b7f75');
    for (let x = -27; x < 29; x += 4) {
      const m = box(this.scene, [2, .015, .07], [x, .026, -31], this.yellow); m.castShadow = false;
    }
    box(this.scene, [.22, .32, 78], [-33, .16, 0], this.concrete);
    box(this.scene, [.22, .32, 78], [33, .16, 0], this.concrete);
    box(this.scene, [66, .3, .22], [0, .15, -35], this.concrete);
    box(this.scene, [56, .25, 2], [0, 3.32, 37], this.concrete);
    cylinderBetween(this.scene, [-28, 3.22, 36], [28, 3.22, 36], .055, this.steel);
  }
  buildSurroundings() {
    const grass = material('#7b9383');
    box(this.scene, [130, .2, 180], [-99, -.3, 0], grass);
    box(this.scene, [130, .2, 180], [99, -.3, 0], grass);
    box(this.scene, [68, .2, 90], [0, -.3, -84], grass);
    box(this.scene, [68, .2, 45], [0, -.3, 61.5], grass);
    // The water and industrial shoreline give the park an open, recognizable setting.
    box(this.scene, [330, .15, 120], [0, -.6, 108], material('#659ea7', { roughness: .25, metalness: .28 }));
    const r = random(17);
    for (let i = 0; i < 38; i++) {
      const x = (r() - .5) * 240, z = 128 + r() * 38, h = 5 + r() * 28;
      box(this.scene, [5 + r() * 9, h, 5 + r() * 10], [x, h / 2 - 1, z], material(i % 2 ? '#a8b6ae' : '#97a9a5'));
    }
    for (let x = -32; x <= 32; x += 4) {
      cylinderBetween(this.scene, [x, .1, 39], [x, 2.2, 39], .04, this.dark);
      if (x < 32) { cylinderBetween(this.scene, [x, 2.2, 39], [x + 4, 2.2, 39], .035, this.dark); cylinderBetween(this.scene, [x, 1.1, 39], [x + 4, 1.1, 39], .025, this.dark); }
    }
    const warehouse = material('#748680');
    box(this.scene, [22, 8, 38], [-51, 4, -10], warehouse);
    box(this.scene, [23, .3, 39], [-51, 8.1, -10], this.dark);
    for (let z = -25; z <= 2; z += 9) { box(this.scene, [.06, 4, 6], [-39.94, 2, z], this.dark); box(this.scene, [.08, .13, 5.7], [-39.88, 3.4, z], this.yellow); }
    for (let i = 0; i < 14; i++) {
      const x = i < 7 ? 39 + r() * 4 : -36 - r() * 2, z = -30 + (i % 7) * 10;
      box(this.scene, [2.3, .6, 2.3], [x, .3, z], this.concrete);
      cylinderBetween(this.scene, [x, .5, z], [x + .2, 4.7, z], .14, material('#766957'));
      for (let j = 0; j < 4; j++) {
        const foliage = mesh(new THREE.IcosahedronGeometry(1.7 + r() * .8, 1), material(j % 2 ? '#557967' : '#668773'), this.scene, x + (r() - .5) * 1.7, 4.5 + r() * 2.2, z + (r() - .5) * 1.5);
        foliage.scale.y = 1.25;
      }
    }
    for (const x of [-31, 31]) for (const z of [-25, 4, 28]) {
      cylinderBetween(this.scene, [x, 0, z], [x, 7, z], .075, this.dark);
      cylinderBetween(this.scene, [x, 7, z], [x - Math.sign(x) * 1.5, 7, z], .07, this.dark);
      box(this.scene, [1.1, .12, .5], [x - Math.sign(x), 7, z], this.dark);
    }
    for (const z of [-22, -10, 3]) {
      const x = 29.5;
      box(this.scene, [1, .16, 3], [x, .54, z], material('#a38257'));
      for (const dz of [-1, 1]) box(this.scene, [.65, .5, .12], [x, .25, z + dz], this.dark);
    }
    for (const [x, z] of [[-28, -28], [26, 27], [27, -13]]) {
      const cone = mesh(new THREE.ConeGeometry(.25, .65, 20), this.terracotta, this.scene, x, .35, z);
      box(this.scene, [.55, .08, .55], [x, .04, z], this.dark);
      mesh(new THREE.CylinderGeometry(.115, .17, .12, 20), material('#e9e4d8'), this.scene, x, cone.position.y, z);
    }
    // A very light painted line makes the plaza legible without cluttering the skating surface.
    for (const x of [-4, 4]) box(this.scene, [.025, .008, 13], [x, .012, -4], material('#e8e5d4'));
  }
  addObstacle(o, ghost = false) {
    const group = new THREE.Group(); group.position.set(o.x, 0, o.z); group.rotation.y = o.yaw;
    this.scene.add(group);
    if (o.type === 'rail') {
      cylinderBetween(group, [0, o.height, -o.length / 2], [0, o.height, o.length / 2], .047, this.dark);
      for (const z of [-o.length * .36, o.length * .36]) {
        cylinderBetween(group, [0, .03, z], [0, o.height, z], .04, this.dark);
        box(group, [.38, .035, .25], [0, .018, z], this.steel);
      }
    } else if (o.type === 'ledge') {
      box(group, [o.width, o.height, o.length], [0, o.height / 2, 0], this.concrete);
      box(group, [o.width + .03, .045, o.length + .03], [0, o.height + .008, 0], material('#bac1b4'));
      for (const x of [-o.width / 2, o.width / 2]) box(group, [.065, .065, o.length], [x, o.height, 0], this.dark);
      box(group, [o.width + .012, .09, o.length + .012], [0, .095, 0], this.terracotta);
    } else {
      const geo = new THREE.PlaneGeometry(o.width, o.length, 4, 90); geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) pos.setY(i, obstacleHeight({ ...o, x: 0, z: 0, yaw: 0 }, pos.getX(i), pos.getZ(i)) + .014);
      geo.computeVertexNormals(); mesh(geo, this.concrete, group);
      for (const x of [-o.width / 2, o.width / 2]) {
        const shape = new THREE.Shape(); shape.moveTo(-o.length / 2, 0);
        for (let j = 0; j <= 90; j++) { const z = -o.length / 2 + j / 90 * o.length; shape.lineTo(z, obstacleHeight({ ...o, x: 0, z: 0, yaw: 0 }, 0, z)); }
        shape.lineTo(o.length / 2, 0); const side = mesh(new THREE.ShapeGeometry(shape), material('#718d82', { side: THREE.DoubleSide }), group, x, 0, 0); side.rotation.y = -Math.PI / 2;
      }
      if (o.type === 'stairs') {
        const start = -o.length * .03, end = o.length / 2 - .2;
        cylinderBetween(group, [0, o.height + .65, start], [0, .65, end], .044, this.dark);
        cylinderBetween(group, [0, o.height, start], [0, o.height + .65, start], .04, this.dark);
      }
    }
    if (ghost) group.traverse(m => { if (m.isMesh) { m.material = m.material.clone(); m.material.transparent = true; m.material.opacity = .42; m.material.color.set('#c7f35e'); m.castShadow = false; } });
    else this.obstacleMeshes.set(o.id, group);
    return group;
  }
  removeObstacle(id) {
    const group = this.obstacleMeshes.get(id); if (!group) return;
    group.traverse(m => { if (m.isMesh) m.geometry.dispose(); }); this.scene.remove(group); this.obstacleMeshes.delete(id);
  }
  setGhost(o, valid = true) {
    if (this.ghost) { this.ghost.traverse(m => { if (m.isMesh) { m.geometry.dispose(); m.material.dispose(); } }); this.scene.remove(this.ghost); }
    this.ghost = o ? this.addObstacle(o, true) : null;
    if (this.ghost && !valid) this.ghost.traverse(m => { if (m.isMesh) m.material.color.set('#f27666'); });
  }
  buildBoard() {
    this.board = new THREE.Group(); this.board.rotation.order = 'YXZ'; this.scene.add(this.board);
    this.deckPivot = new THREE.Group(); this.board.add(this.deckPivot);
    const rows = 48, cols = 10, positions = [], uvs = [], indices = [];
    for (let i = 0; i <= rows; i++) {
      const z = (i / rows - .5) * .84, end = Math.max(0, Math.abs(z) - .3);
      const width = .105 * Math.sqrt(Math.max(.035, 1 - (end / .122) ** 2));
      for (let j = 0; j <= cols; j++) {
        const x = (j / cols * 2 - 1) * width;
        positions.push(x, .125 + (end / .12) ** 1.6 * .068 + (x / .105) ** 2 * .012, z);
        uvs.push(j / cols, i / rows);
      }
    }
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      const a = i * (cols + 1) + j, b = a + cols + 1; indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geo.setIndex(indices); geo.computeVertexNormals();
    const rng = random();
    const gripTex = canvasTexture(256, 1024, (c, w, h) => {
      c.fillStyle = '#242927'; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 18000; i++) { c.fillStyle = rng() > .5 ? '#3b423c' : '#171c19'; c.fillRect(rng() * w, rng() * h, 1, 1); }
      c.fillStyle = '#c7f35e'; c.fillRect(0, h * .69, w, 8); c.fillRect(0, h * .71, w, 3);
      c.font = 'bold 52px Arial'; c.textAlign = 'center'; c.save(); c.translate(w / 2, h / 2); c.rotate(Math.PI / 2); c.fillText('sk8.io', 0, 18); c.restore();
    });
    this.gripMat = material('#ffffff', { map: gripTex, side: THREE.DoubleSide });
    mesh(geo, this.gripMat, this.deckPivot);
    this.bottomMat = material('#c7f35e', { side: THREE.DoubleSide });
    const bottom = mesh(geo.clone(), this.bottomMat, this.deckPivot); bottom.position.y = -.012;
    const wood = material('#bf935b');
    for (const sign of [-1, 1]) {
      const path = [];
      for (let i = 0; i <= rows; i++) { const idx = i * (cols + 1) + (sign < 0 ? 0 : cols); path.push(new THREE.Vector3(positions[idx * 3], positions[idx * 3 + 1] - .006, positions[idx * 3 + 2])); }
      mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(path), 48, .006, 6, false), wood, this.deckPivot);
    }
    this.wheels = []; this.wheelMat = material('#efe6ce', { roughness: .6 });
    for (const z of [-.25, .25]) {
      box(this.deckPivot, [.082, .012, .08], [0, .106, z], this.steel);
      cylinderBetween(this.deckPivot, [0, .105, z - .016], [0, .058, z + .018], .014, this.steel);
      cylinderBetween(this.deckPivot, [-.114, .053, z], [.114, .053, z], .013, this.steel);
      for (const x of [-.116, .116]) {
        const wheel = mesh(new THREE.CylinderGeometry(.031, .031, .027, 24), this.wheelMat, this.deckPivot, x, .052, z); wheel.rotation.z = Math.PI / 2; this.wheels.push(wheel);
        const bearing = mesh(new THREE.CylinderGeometry(.012, .012, .03, 12), this.dark, this.deckPivot, x, .052, z); bearing.rotation.z = Math.PI / 2;
      }
      for (const x of [-.03, .03]) for (const offset of [-.026, .026]) mesh(new THREE.CylinderGeometry(.004, .004, .002, 8), this.steel, this.deckPivot, x, .128, z + offset);
    }
    this.board.scale.setScalar(1.3);
    const shadowTex = canvasTexture(128, 128, (c, w, h) => {
      const g = c.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, 60); g.addColorStop(0, 'rgba(15,25,20,.4)'); g.addColorStop(1, 'rgba(15,25,20,0)'); c.fillStyle = g; c.fillRect(0, 0, w, h);
    });
    this.contactShadow = mesh(new THREE.PlaneGeometry(.8, 1.5), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }), this.scene);
    this.contactShadow.rotation.x = -Math.PI / 2; this.contactShadow.castShadow = false;
  }
  applySettings(settings) {
    this.settings = settings; this.bottomMat.color.set(settings.deck); this.wheelMat.color.set(settings.wheels);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, settings.quality === 'low' ? 1 : 1.75)); this.renderer.shadowMap.enabled = settings.quality !== 'low';
    const sunset = settings.light === 'sunset';
    this.sun.color.set(sunset ? '#ffbd83' : '#fff2ce'); this.sun.position.set(-22, sunset ? 15 : 40, -18);
    this.hemi.intensity = sunset ? 1.6 : 2.4; this.scene.background.set(sunset ? '#c5b5ae' : '#b5d2d4'); this.scene.fog.color.copy(this.scene.background);
    this.resize();
  }
  render(p, dt, playing, orbit = 0, build = false) {
    this.time += dt;
    this.board.position.set(p.x, p.y + .005, p.z);
    this.board.rotation.set(-p.pitch + (p.manualTime > 0 ? .18 : 0) + p.charge * .09, p.yaw, p.roll);
    const flipAngle = p.flip ? Math.min(1, p.flip.t / p.flip.duration) * Math.PI * 2 * p.flip.direction : 0;
    const shuvAngle = p.shuv ? Math.min(1, p.shuv.t / p.shuv.duration) * Math.PI * 2 : 0;
    this.deckPivot.rotation.set(0, shuvAngle, flipAngle);
    if (p.bailTime > 0) { this.deckPivot.rotation.z += (1.15 - p.bailTime) * 7; this.deckPivot.rotation.x = (1.15 - p.bailTime) * 4; }
    this.wheelRotation += p.speed * dt / .031; this.wheels.forEach(w => { w.rotation.x = this.wheelRotation; });
    this.contactShadow.position.set(p.x, baseHeight(p.x, p.z) + .021, p.z); this.contactShadow.rotation.z = -p.yaw;
    this.contactShadow.material.opacity = Math.max(.12, 1 - (p.y - baseHeight(p.x, p.z)) / 5);
    this.cameraYaw += orbit * dt * 2;
    const target = new THREE.Vector3(); const look = new THREE.Vector3();
    if (!playing) {
      const a = this.time * .025;
      target.set(12 + Math.sin(a) * 3, 9, -29 + Math.cos(a) * 2); look.set(-2, 0, 0);
    } else if (build) {
      target.set(p.x + 7, p.y + 11, p.z - 9); look.set(p.x + Math.sin(p.yaw) * 4, p.y, p.z + Math.cos(p.yaw) * 4);
    } else {
      const angle = p.yaw + this.cameraYaw, low = this.cameraMode === 1, dist = low ? 2.45 : 3.8;
      target.set(p.x - Math.sin(angle) * dist, p.y + (low ? 1.05 : 2.25), p.z - Math.cos(angle) * dist);
      target.y = Math.max(target.y, baseHeight(target.x, target.z) + .6);
      look.set(p.x + Math.sin(p.yaw) * .9, p.y + .15, p.z + Math.cos(p.yaw) * .9);
    }
    const smooth = 1 - Math.exp(-dt * (playing ? 6 : 1.4));
    this.camera.position.lerp(target, smooth); this.look.lerp(look, 1 - Math.exp(-dt * 9)); this.camera.lookAt(this.look);
    const fov = 57 + (playing ? Math.min(p.speed, 12) * .6 : 0); this.camera.fov += (fov - this.camera.fov) * smooth; this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
  }
}
