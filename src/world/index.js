// SK8.IO world: procedural skatepark, atmosphere, colliders, grind rails, object dropper and props.
// See CONTRACTS.md section 1.
import * as THREE from 'three';
import { createTextures } from './textures.js';
import { createMaterials } from './materials.js';
import { createAtmosphere } from './atmosphere.js';
import { Builder, matFromPosYaw } from './builder.js';
import { buildPark, PARK } from './park.js';
import { buildScenery } from './scenery.js';
import { createProp, kickProp as kickPropImpl, updateProps, resetProp } from './props.js';
import { CATALOG, PROP_IDS, getTemplate, instantiate } from './objects.js';

export { CATALOG };

export function createWorld(renderer, scene) {
  const t0 = performance.now();
  const tex = createTextures(renderer);
  const M = createMaterials(tex);
  const atm = createAtmosphere(renderer, scene);

  const root = new THREE.Group();
  root.name = 'world';
  scene.add(root);

  // ---- static park ----
  const b = new Builder();
  const park = buildPark(b);
  const decoGroup = new THREE.Group();
  decoGroup.name = 'scenery';
  buildScenery(b, decoGroup, M, park);
  const staticMeshes = b.buildMeshes(M);
  for (const m of staticMeshes) {
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    root.add(m);
  }
  root.add(decoGroup);
  const colliders = b.buildColliders(M.collider);
  for (const c of colliders) {
    c.matrixAutoUpdate = false;
    c.updateMatrixWorld(true);
  }
  const rails = b.rails.slice();
  root.updateMatrixWorld(true);

  // ---- dynamic props ----
  const props = [];
  const propGroup = new THREE.Group();
  propGroup.name = 'props';
  root.add(propGroup);
  for (const [kind, x, z] of park.props) {
    const p = createProp(kind, M, new THREE.Vector3(x, 0, z));
    props.push(p);
    propGroup.add(p.object3d);
  }

  // ---- shadow follow ----
  const sun = atm.sun;
  const sunDir = atm.sunDir.clone();
  const lightRight = new THREE.Vector3();
  const lightUp = new THREE.Vector3();
  {
    const fwd = sunDir.clone().negate();
    lightRight.crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    lightUp.crossVectors(lightRight, fwd).normalize();
  }
  const texel = (sun.shadow.camera.right - sun.shadow.camera.left) / sun.shadow.mapSize.x;
  const _f = new THREE.Vector3();
  let time = 0;

  function update(dt, focus, camera) {
    time += dt;
    if (focus) {
      // snap the shadow frustum center to texel increments (prevents shimmering)
      const r = focus.dot(lightRight);
      const u = focus.dot(lightUp);
      const f = focus.dot(sunDir);
      const rs = Math.round(r / texel) * texel;
      const us = Math.round(u / texel) * texel;
      _f.copy(lightRight).multiplyScalar(rs).addScaledVector(lightUp, us).addScaledVector(sunDir, f);
      sun.target.position.copy(_f);
      sun.position.copy(_f).addScaledVector(sunDir, 120);
      sun.target.updateMatrixWorld();
      sun.updateMatrixWorld();
    }
    atm.sky.material.uniforms.time.value = time;
    if (camera) atm.sky.position.copy(camera.position);
    updateProps(props, dt, PARK - 0.4);
  }

  // ---- object dropper ----
  const placed = [];
  const placedGroup = new THREE.Group();
  placedGroup.name = 'placed';
  root.add(placedGroup);
  const ghostMat = new THREE.MeshStandardMaterial({
    color: 0x7fd8ff,
    emissive: 0x1d5f8a,
    emissiveIntensity: 0.6,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    roughness: 0.4,
  });

  const world = {
    colliders,
    rails,
    spawn: park.spawn,
    spots: park.spots,
    sun,
    scene,
    root,
    materials: M,
    props,
    catalog: CATALOG.map((c) => ({ ...c })),
    placed,
    onChange: null,
    update,
    kickProp(prop, impulse) {
      kickPropImpl(prop, impulse);
    },
    resetProps() {
      for (const p of props) if (!p.placedHandle) resetProp(p);
    },
    placeObject(id, position, yaw = 0, _silent = false) {
      const pos = position.clone ? position.clone() : new THREE.Vector3(position.x, position.y, position.z);
      if (PROP_IDS[id]) {
        const p = createProp(PROP_IDS[id], M, pos, yaw);
        props.push(p);
        propGroup.add(p.object3d);
        const handle = { id, group: p.object3d, prop: p, colliders: [], rails: [], position: pos, yaw };
        p.placedHandle = handle;
        placed.push(handle);
        return handle;
      }
      const t = getTemplate(id, M);
      if (!t) return null;
      const m = matFromPosYaw(pos.x, pos.y, pos.z, yaw);
      const inst = instantiate(t, m);
      inst.group.name = 'placed:' + id;
      placedGroup.add(inst.group);
      inst.group.updateMatrixWorld(true);
      for (const c of inst.colliders) colliders.push(c);
      for (const r of inst.rails) rails.push(r);
      const handle = { id, group: inst.group, colliders: inst.colliders, rails: inst.rails, position: pos, yaw };
      placed.push(handle);
      if (!_silent && world.onChange) world.onChange();
      return handle;
    },
    removeObject(handle, _silent = false) {
      const i = placed.indexOf(handle);
      if (i < 0) return;
      placed.splice(i, 1);
      if (handle.prop) {
        const k = props.indexOf(handle.prop);
        if (k >= 0) props.splice(k, 1);
        propGroup.remove(handle.prop.object3d);
        return;
      }
      placedGroup.remove(handle.group);
      for (const c of handle.colliders) {
        const k = colliders.indexOf(c);
        if (k >= 0) colliders.splice(k, 1);
      }
      for (const r of handle.rails) {
        const k = rails.indexOf(r);
        if (k >= 0) rails.splice(k, 1);
      }
      if (!_silent && world.onChange) world.onChange();
    },
    makeGhost(id) {
      const g = new THREE.Group();
      g.name = 'ghost:' + id;
      if (PROP_IDS[id]) {
        const p = createProp(PROP_IDS[id], M, new THREE.Vector3(), 0);
        p.object3d.traverse((o) => {
          if (o.isMesh) {
            o.material = ghostMat;
            o.castShadow = false;
          }
        });
        g.add(p.object3d);
        return g;
      }
      const t = getTemplate(id, M);
      if (!t) return g;
      for (const m of t.meshes) {
        const c = new THREE.Mesh(m.geometry, ghostMat);
        c.renderOrder = 10;
        g.add(c);
      }
      return g;
    },
    serialize() {
      return placed.map((h) => ({ id: h.id, x: +h.position.x.toFixed(3), y: +h.position.y.toFixed(3), z: +h.position.z.toFixed(3), yaw: +h.yaw.toFixed(4) }));
    },
    deserialize(list) {
      for (const h of placed.slice()) world.removeObject(h, true);
      for (const e of list || []) {
        if (!e || !e.id) continue;
        world.placeObject(e.id, new THREE.Vector3(e.x, e.y, e.z), e.yaw || 0, true);
      }
      if (world.onChange) world.onChange();
    },
    // diagnostics
    stats: null,
    calibrateFog: atm.calibrateFog,
  };

  atm.calibrateFog();

  let tris = 0;
  for (const c of colliders) tris += (c.geometry.index ? c.geometry.index.count : c.geometry.attributes.position.count) / 3;
  world.stats = {
    buildMs: Math.round(performance.now() - t0),
    textureMs: Math.round(tex.buildMs),
    colliderTriangles: tris,
    colliderMeshes: colliders.length,
    rails: rails.length,
    staticMeshes: staticMeshes.length,
  };
  return world;
}
