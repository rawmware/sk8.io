import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

// Lightweight demo park (used by demo.html while the full world module is in progress).

function noiseTex(base, spread, size = 512, repeat = 1, lines = false) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const n = (Math.random() - 0.5) * spread;
    img.data[i * 4] = base[0] + n;
    img.data[i * 4 + 1] = base[1] + n;
    img.data[i * 4 + 2] = base[2] + n;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  ctx.globalAlpha = 0.08;
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? '#000' : '#fff';
    ctx.beginPath();
    ctx.arc(Math.random() * size, Math.random() * size, 10 + Math.random() * 60, 0, 7);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  if (lines) {
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, size, size);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function createWorld(renderer, scene) {
  const colliders = [];
  const rails = [];
  const mats = {
    ground: new THREE.MeshStandardMaterial({ map: noiseTex([118, 114, 108], 26, 512, 40, true), roughness: 0.92 }),
    smooth: new THREE.MeshStandardMaterial({ map: noiseTex([140, 137, 130], 14, 512, 6), roughness: 0.7 }),
    wood: new THREE.MeshStandardMaterial({ map: noiseTex([120, 92, 64], 18, 256, 4), roughness: 0.75 }),
    metal: new THREE.MeshStandardMaterial({ color: '#9aa0a8', roughness: 0.3, metalness: 0.9 }),
    paint: new THREE.MeshStandardMaterial({ color: '#d8572a', roughness: 0.5, metalness: 0.4 }),
    side: new THREE.MeshStandardMaterial({ color: '#5a5d63', roughness: 0.85 }),
    grass: new THREE.MeshStandardMaterial({ map: noiseTex([70, 100, 50], 30, 256, 30), roughness: 1 }),
  };

  // ---- sky & light ----
  const sky = new Sky();
  sky.scale.setScalar(4000);
  const u = sky.material.uniforms;
  u.turbidity.value = 6;
  u.rayleigh.value = 1.6;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.85;
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(62), THREE.MathUtils.degToRad(215));
  u.sunPosition.value.copy(sunDir);
  scene.add(sky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(sky.clone());
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = 0.45;
  renderer.toneMappingExposure = 0.72;
  scene.fog = new THREE.Fog('#c9d3dc', 90, 320);
  scene.add(new THREE.HemisphereLight('#cfe3ff', '#6b5e4e', 0.6));
  const sun = new THREE.DirectionalLight('#ffe9cc', 2.4);
  sun.position.copy(sunDir).multiplyScalar(60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -30;
  sc.right = sc.top = 30;
  sc.near = 1;
  sc.far = 160;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  const add = (mesh, surface, collide = true) => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    mesh.updateMatrixWorld(true);
    if (collide) {
      mesh.userData.surface = surface;
      colliders.push(mesh);
    }
    return mesh;
  };

  // ground
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(140, 140).rotateX(-Math.PI / 2), mats.ground);
  add(ground, 'concrete');
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2), mats.grass);
  grass.position.y = -0.25;
  grass.receiveShadow = true;
  scene.add(grass);

  // ---- shapes ----
  function rampGeometry(R, H, deck, width, segs = 28) {
    // side profile in (x = horizontal, y = height), extruded along z (width)
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    const aMax = Math.acos(Math.max(-1, 1 - H / R));
    let ux = 0;
    for (let i = 1; i <= segs; i++) {
      const a = (i / segs) * aMax;
      ux = Math.sin(a) * R;
      s.lineTo(ux, R - Math.cos(a) * R);
    }
    const vert = H > R ? H - R : 0;
    if (vert > 0) s.lineTo(R, H);
    const top = vert > 0 ? R : ux;
    s.lineTo(top + deck, H);
    s.lineTo(top + deck, 0);
    s.lineTo(0, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false, curveSegments: 1 });
    g.translate(0, 0, -width / 2);
    return { g, top };
  }

  // ramp facing direction "yaw": riders approach traveling along +local x
  function addRamp(R, H, deck, width, x, z, yaw, mat = mats.smooth, surface = 'smoothConcrete', coping = true) {
    const { g, top } = rampGeometry(R, H, deck, width);
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, 0, z);
    m.rotation.y = yaw;
    add(m, surface);
    if (coping) {
      const cop = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, width, 10).rotateX(Math.PI / 2), mats.metal);
      cop.position.set(top, H, 0);
      m.add(cop);
      cop.castShadow = true;
      const a = new THREE.Vector3(top, H + 0.03, -width / 2).applyMatrix4(m.matrixWorld);
      const b = new THREE.Vector3(top, H + 0.03, width / 2).applyMatrix4(m.matrixWorld);
      rails.push({ a, b, kind: 'coping', radius: 0.03 });
    }
    return m;
  }

  function addBox(w, h, d, x, y, z, yaw, mat, surface, edgeRails = true, kind = 'concrete', parentList = colliders, railList = rails) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y + h / 2, z);
    m.rotation.y = yaw;
    m.castShadow = m.receiveShadow = true;
    m.updateMatrixWorld(true);
    m.userData.surface = surface;
    if (edgeRails) {
      for (const sx of [-1, 1]) {
        const a = new THREE.Vector3((sx * w) / 2, h / 2, -d / 2).applyMatrix4(m.matrixWorld);
        const b = new THREE.Vector3((sx * w) / 2, h / 2, d / 2).applyMatrix4(m.matrixWorld);
        railList.push({ a, b, kind, radius: 0.01 });
      }
    }
    return m;
  }

  function railMesh(a, b, r = 0.025, mat = mats.paint) {
    const group = new THREE.Group();
    const len = a.distanceTo(b);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), mat);
    bar.position.copy(a).add(b).multiplyScalar(0.5);
    bar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(b, a).normalize());
    group.add(bar);
    const n = Math.max(2, Math.round(len / 2.2) + 1);
    for (let i = 0; i < n; i++) {
      const p = new THREE.Vector3().lerpVectors(a, b, i / (n - 1));
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, p.y, 8), mat);
      post.position.set(p.x, p.y / 2, p.z);
      group.add(post);
    }
    group.traverse((o) => (o.castShadow = true));
    return group;
  }

  // ---- layout ----
  // big quarter pipes at both ends of the plaza
  addRamp(2.6, 2.2, 2.5, 14, 0, 26, -Math.PI / 2);
  addRamp(2.6, 2.2, 2.5, 14, 0, -26, Math.PI / 2);
  // mini ramp (two facing quarter pipes with flat bottom)
  addRamp(2.2, 1.3, 2.0, 7, 22, 3, -Math.PI / 2, mats.wood, 'wood');
  addRamp(2.2, 1.3, 2.0, 7, 22, -3, Math.PI / 2, mats.wood, 'wood');
  // vert ramp extension at the side
  addRamp(3.0, 3.4, 2.4, 10, -26, 0, Math.PI, mats.wood, 'wood');
  // kickers
  addRamp(4.5, 0.55, 0.0, 2.2, -8, 6, -Math.PI / 2, mats.wood, 'wood', false);
  addRamp(6, 0.9, 1.2, 2.6, 8, -12, Math.PI / 2, mats.wood, 'wood', false);
  // ledges
  for (const [x, z, len, h] of [[-6, -8, 7, 0.42], [6, 8, 6, 0.55], [12, -2, 8, 0.35]]) {
    const m = addBox(0.6, h, len, x, 0, z, 0, mats.smooth, 'concrete');
    scene.add(m);
    colliders.push(m);
  }
  // manual pad
  {
    const m = addBox(3, 0.18, 7, -14, 0, -12, 0, mats.smooth, 'concrete', true, 'concrete');
    scene.add(m);
    colliders.push(m);
  }
  // flat bars & handrail
  for (const [ax, az, bx, bz, y] of [[-3, 10, -3, 18, 0.45], [3, -16, 3, -9, 0.35]]) {
    const a = new THREE.Vector3(ax, y, az);
    const b = new THREE.Vector3(bx, y, bz);
    scene.add(railMesh(a, b));
    rails.push({ a: a.clone().setY(y + 0.025), b: b.clone().setY(y + 0.025), kind: 'metal', radius: 0.025 });
  }
  // stair set with a handrail
  {
    const stepH = 0.17, stepD = 0.38, n = 5, width = 5;
    const topH = stepH * n;
    const plat = addBox(width, topH, 4, -16, 0, 14, 0, mats.smooth, 'concrete', false);
    scene.add(plat);
    colliders.push(plat);
    for (let i = 0; i < n - 1; i++) {
      const m = addBox(width, topH - stepH * (i + 1), stepD, -16, 0, 12 - i * stepD - stepD / 2, 0, mats.smooth, 'concrete', false);
      scene.add(m);
      colliders.push(m);
    }
    const a = new THREE.Vector3(-14.2, topH + 0.85, 12.2);
    const b = new THREE.Vector3(-14.2, 0.85, 12 - n * stepD - 0.2);
    scene.add(railMesh(a, b));
    rails.push({ a: a.clone().setY(a.y + 0.025), b: b.clone().setY(b.y + 0.025), kind: 'metal', radius: 0.025 });
  }
  // perimeter walls
  for (const [x, z, w, d] of [[0, 70, 140, 1], [0, -70, 140, 1], [70, 0, 1, 140], [-70, 0, 1, 140]]) {
    const m = addBox(w, 2.5, d, x, 0, z, 0, mats.side, 'concrete', false);
    scene.add(m);
    colliders.push(m);
  }
  // trees & lamps around for depth
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#5b4632', roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: '#4f7a3a', roughness: 0.9 });
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const r = 80 + Math.random() * 40;
    const t = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 4, 8), trunkMat);
    trunk.position.y = 2;
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(2.6 + Math.random(), 1), leafMat);
    crown.position.y = 5.5;
    t.add(trunk, crown);
    t.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    t.traverse((o) => (o.castShadow = true));
    scene.add(t);
  }

  // ---- props: knockable cones ----
  const props = [];
  const coneMat = new THREE.MeshStandardMaterial({ color: '#ff6a1a', roughness: 0.6 });
  for (let i = 0; i < 8; i++) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 14).translate(0, 0.25, 0), coneMat);
    cone.position.set(-4 + i * 1.2, 0, -2 - (i % 2) * 1.4);
    cone.castShadow = true;
    scene.add(cone);
    props.push({ object3d: cone, radius: 0.2, velocity: new THREE.Vector3(), angularVelocity: new THREE.Vector3(), baseY: 0 });
  }

  // ---- object dropper ----
  const catalog = [
    { id: 'kicker', name: 'Kicker', category: 'ramps' },
    { id: 'quarter', name: 'Quarter Pipe', category: 'ramps' },
    { id: 'ledge', name: 'Ledge', category: 'street' },
    { id: 'flatbar', name: 'Flat Bar', category: 'street' },
    { id: 'manualpad', name: 'Manual Pad', category: 'street' },
  ];
  function build(id) {
    const group = new THREE.Group();
    const cols = [];
    const localRails = [];
    if (id === 'kicker' || id === 'quarter') {
      const { g, top } = id === 'kicker' ? rampGeometry(4.5, 0.6, 0.3, 2.4) : rampGeometry(2.2, 1.5, 1.2, 4);
      const m = new THREE.Mesh(g, mats.wood);
      m.rotation.y = -Math.PI / 2;
      m.userData.surface = 'wood';
      group.add(m);
      cols.push(m);
      if (id === 'quarter') localRails.push({ a: new THREE.Vector3(-2, 1.53, top), b: new THREE.Vector3(2, 1.53, top), kind: 'coping' });
    } else if (id === 'ledge' || id === 'manualpad') {
      const [w, h, d] = id === 'ledge' ? [0.5, 0.45, 4] : [2.4, 0.18, 5];
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), id === 'ledge' ? mats.wood : mats.smooth);
      m.userData.surface = id === 'ledge' ? 'wood' : 'concrete';
      group.add(m);
      cols.push(m);
      for (const sx of [-1, 1]) localRails.push({ a: new THREE.Vector3((sx * w) / 2, h, -d / 2), b: new THREE.Vector3((sx * w) / 2, h, d / 2), kind: id === 'ledge' ? 'wood' : 'concrete' });
    } else if (id === 'flatbar') {
      const a = new THREE.Vector3(0, 0.38, -2.5);
      const b = new THREE.Vector3(0, 0.38, 2.5);
      group.add(railMesh(a, b));
      localRails.push({ a: a.clone().setY(0.405), b: b.clone().setY(0.405), kind: 'metal' });
    }
    group.traverse((o) => {
      if (o.isMesh) o.castShadow = o.receiveShadow = true;
    });
    return { group, cols, localRails };
  }

  const placed = [];
  const world = {
    colliders,
    rails,
    spawn: { position: new THREE.Vector3(0, 0, -6), yaw: 0 },
    spots: [
      { name: 'Plaza', position: new THREE.Vector3(0, 0, -6), yaw: 0 },
      { name: 'Mini Ramp', position: new THREE.Vector3(22, 0, 0), yaw: 0 },
      { name: 'Vert', position: new THREE.Vector3(-14, 0, 0), yaw: -Math.PI / 2 },
      { name: 'Stairs', position: new THREE.Vector3(-16, 0.85, 14.5), yaw: Math.PI },
      { name: 'Ledges', position: new THREE.Vector3(6, 0, -2), yaw: 0 },
    ],
    sun,
    catalog,
    placed,
    props,
    onChange: null,
    update(dt, focus) {
      sun.position.copy(focus).addScaledVector(sunDir, 60);
      sun.target.position.copy(focus);
      for (const p of props) {
        const o = p.object3d;
        if (p.velocity.lengthSq() < 1e-4 && o.position.y <= p.baseY + 1e-3) continue;
        p.velocity.y -= 9.81 * dt;
        o.position.addScaledVector(p.velocity, dt);
        o.rotation.x += p.angularVelocity.x * dt;
        o.rotation.z += p.angularVelocity.z * dt;
        if (o.position.y < p.baseY) {
          o.position.y = p.baseY;
          p.velocity.y *= -0.3;
          p.velocity.x *= 0.7;
          p.velocity.z *= 0.7;
          p.angularVelocity.multiplyScalar(0.7);
          if (p.velocity.lengthSq() < 0.05) p.velocity.set(0, 0, 0);
        }
      }
    },
    kickProp(p, impulse) {
      p.velocity.copy(impulse);
      p.angularVelocity.set((Math.random() - 0.5) * 12, 0, (Math.random() - 0.5) * 12);
    },
    makeGhost(id) {
      const { group } = build(id);
      group.traverse((o) => {
        if (o.isMesh) {
          o.material = new THREE.MeshBasicMaterial({ color: '#ff5a1f', transparent: true, opacity: 0.45, depthWrite: false });
          o.castShadow = false;
        }
      });
      return group;
    },
    placeObject(id, position, yaw) {
      const { group, cols, localRails } = build(id);
      group.position.copy(position);
      group.rotation.y = yaw;
      scene.add(group);
      group.updateMatrixWorld(true);
      const h = {
        id,
        group,
        colliders: cols,
        rails: localRails.map((r) => ({ a: r.a.clone().applyMatrix4(group.matrixWorld), b: r.b.clone().applyMatrix4(group.matrixWorld), kind: r.kind, radius: 0.02 })),
      };
      placed.push(h);
      world.onChange?.();
      return h;
    },
    removeObject(h) {
      const i = placed.indexOf(h);
      if (i >= 0) placed.splice(i, 1);
      scene.remove(h.group);
      world.onChange?.();
    },
    serialize() {
      return placed.map((h) => ({ id: h.id, x: h.group.position.x, y: h.group.position.y, z: h.group.position.z, yaw: h.group.rotation.y }));
    },
    deserialize(list) {
      const cb = world.onChange;
      world.onChange = null;
      for (const o of list) if (catalog.find((c) => c.id === o.id)) world.placeObject(o.id, new THREE.Vector3(o.x, o.y, o.z), o.yaw);
      world.onChange = cb;
      cb?.();
    },
  };
  return world;
}
