// Body: skinned skin mesh (head, neck, arms, hands, legs), eyes. Also exports the head surface function used by
// hair / headwear builders so everything hugs the same skull.
import * as THREE from 'three';
import { BI } from './rig.js';
import { Part, tubePart, spherePart, pathTubePart, blendW, buildGeometry, gridPart } from './geometry.js';
import { smoothstep, clamp } from './util.js';
import { paintSkin, paintEyes, headDirToUV, BODY_UV } from './textures.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const W1 = (name) => [[BI[name], 1]];

// ------------------------------------------------------------------ head surface
const _g = (dx, dy, dz, wx, wy, wz) => Math.exp(-((dx * dx) / (wx * wx) + (dy * dy) / (wy * wy) + (dz * dz) / (wz * wz)));

/**
 * Head surface in head-centred coordinates (x left, y up, z forward). d = unit direction.
 * Returns the base skull point (without feature bumps when bare = true).
 */
export function headSurface(d, R, out, bare = false) {
  const k = R.y / 0.117;
  const x = d.x;
  const y = d.y;
  const z = d.z;
  let sx = R.x;
  let sz = R.z;
  // jaw narrows toward the chin, more at the front
  const low = smoothstep(0.05, -0.92, y);
  sx *= 1 - low * (0.2 + 0.16 * Math.max(0, z));
  // tuck under the occiput toward the nape
  if (z < 0) sz *= 1 - 0.3 * smoothstep(-0.3, -0.95, y) * -z;
  // cranium a touch fuller at the back-top
  if (y > -0.1 && z < 0.2) sx *= 1 + 0.035 * smoothstep(-0.1, 0.5, y) * (0.2 - z) / 1.2;
  let px = x * sx;
  const py = y * R.y;
  let pz = z * sz;
  // flatten the face plane slightly and slope the forehead
  if (z > 0) {
    pz *= 1 - 0.07 * z * z * (1 - smoothstep(0.4, 0.9, y));
    pz -= 0.006 * k * smoothstep(0.35, 0.95, y) * z;
  }
  out.set(px, py, pz);
  if (bare) return out;
  // feature bumps along the radial-ish normal (metric gaussians)
  const X = px / k;
  const Y = py / k;
  const Z = pz / k;
  let b = 0;
  if (Z > 0.02) {
    const ax = Math.abs(X);
    b += -0.0075 * _g(ax - 0.032, Y - 0.006, Z - 0.088, 0.016, 0.012, 0.03); // eye sockets
    b += 0.0035 * _g(ax - 0.03, Y - 0.027, Z - 0.088, 0.02, 0.008, 0.03); // brow ridge
    b += 0.002 * _g(X, Y - 0.03, Z - 0.09, 0.02, 0.012, 0.03);
    b += 0.0045 * _g(ax - 0.05, Y + 0.022, Z - 0.068, 0.018, 0.014, 0.03); // cheekbones
    b += -0.0025 * _g(ax - 0.048, Y + 0.062, Z - 0.06, 0.016, 0.018, 0.03); // cheek hollow
    b += 0.0045 * _g(X, Y + 0.06, Z - 0.085, 0.02, 0.011, 0.03); // lips / muzzle
    b += -0.0016 * _g(X, Y + 0.0635, Z - 0.088, 0.019, 0.0022, 0.03); // mouth line
    b += 0.006 * _g(X, Y + 0.104, Z - 0.068, 0.02, 0.014, 0.03); // chin
    b += 0.003 * _g(X, Y + 0.035, Z - 0.09, 0.012, 0.03, 0.03); // nose root fill
  }
  b += -0.0018 * _g(Math.abs(X) - 0.068, Y - 0.035, Z - 0.035, 0.015, 0.02, 0.02); // temples
  if (b !== 0) {
    const l = Math.hypot(px / (R.x * R.x), py / (R.y * R.y), pz / (R.z * R.z)) || 1;
    out.x += ((px / (R.x * R.x)) / l) * b * k;
    out.y += ((py / (R.y * R.y)) / l) * b * k;
    out.z += ((pz / (R.z * R.z)) / l) * b * k;
  }
  return out;
}

/** approx outward normal of the skull for direction d */
export function headNormal(d, R, out) {
  return out.set(d.x / R.x, d.y / R.y, d.z / R.z).normalize();
}

/** finds a point on the face surface near metric (x, y) on the front (z > 0) */
export function facePoint(R, x, y, out, lift = 0) {
  const ux = x / R.x;
  const uy = y / R.y;
  const d = V(ux, uy, Math.sqrt(Math.max(0.02, 1 - ux * ux - uy * uy))).normalize();
  // iterate a couple of times to correct for the deformation in x
  for (let i = 0; i < 3; i++) {
    headSurface(d, R, out);
    d.x += (x - out.x) / R.x;
    d.y += (y - out.y) / R.y;
    d.normalize();
  }
  headSurface(d, R, out);
  if (lift) out.addScaledVector(headNormal(d, R, new THREE.Vector3()), lift);
  return out;
}

export function eyeCenter(R, side) {
  const k = R.y / 0.117;
  return V(side * 0.032 * k, 0.006 * k, 0.0755 * k);
}
export const EYE_R = 0.0122;

// ------------------------------------------------------------------ head parts (head-centred coordinates)
function headParts(dims) {
  const R = dims.headR;
  const k = dims.k;
  const parts = [];
  // skull with face (sphere uv -> head region of the skin canvas)
  const skull = spherePart(64, 48, (d, u, v, out, o) => {
    headSurface(d, R, out);
    const [uu, vv] = headDirToUV(d.x, d.y, d.z);
    o.u = uu;
    o.v = vv;
  });
  parts.push(skull);
  // nose
  const nose = spherePart(20, 16, (d, u, v, out, o) => {
    const t = d.y; // -1 bottom .. 1 top (bridge)
    const wide = 0.42 + 0.58 * smoothstep(0.7, -0.55, t);
    let x = d.x * 0.0155 * wide;
    let y = d.y * 0.029;
    let z = d.z * 0.019 * (0.55 + 0.45 * smoothstep(0.9, -0.3, t));
    if (d.y < -0.6) y = -0.029 * (0.6 + (d.y + 0.6) * 0.35) - 0.0; // flatter underside
    // nostril wings
    z += 0.004 * Math.max(0, -t) * (1 - Math.abs(d.x));
    x *= 1 + 0.25 * smoothstep(-0.2, -0.8, t);
    out.set(x, y, z).multiplyScalar(k);
    out.z += (-t * 0.006 + 0.0) * k; // slope: tip forward
    out.add(V(0, -0.019 * k, 0.088 * k));
    const [uu, vv] = headDirToUV(out.x / R.x, out.y / R.y, out.z / R.z);
    o.u = uu;
    o.v = vv;
  });
  parts.push(nose);
  // ears
  for (const side of [1, -1]) {
    const ear = spherePart(16, 12, (d, u, v, out, o) => {
      // ear: thin in x, tall in y, rounded; cup on the outer face
      let x = d.x * 0.0085;
      const y = d.y * 0.03 * (d.y < 0 ? 0.85 : 1);
      const z = d.z * 0.019 * (d.y > 0 ? 1 : 0.8);
      if (d.x > 0) x -= 0.005 * Math.max(0, 1 - (d.y * d.y + d.z * d.z) * 1.4);
      out.set(x, y, z);
      // flare: rotate so the back edge sticks out from the head
      const a = 0.32;
      const rx = out.x * Math.cos(a) + out.z * Math.sin(a);
      const rz = -out.x * Math.sin(a) + out.z * Math.cos(a);
      out.set(rx * side, out.y, rz).multiplyScalar(k);
      out.add(V(side * 0.071 * k, -0.006 * k, -0.01 * k));
      const [uu, vv] = headDirToUV(out.x / R.x, out.y / R.y, out.z / R.z);
      o.u = uu;
      o.v = vv;
    });
    parts.push(ear);
  }
  // eyelids (upper & lower), skin
  for (const side of [1, -1]) {
    const c = eyeCenter(R, side);
    const lr = (EYE_R + 0.0012) * k;
    const lidFn = (th0, th1, tiltX) =>
      spherePart(
        14,
        6,
        (d, u, v, out, o) => {
          out.copy(d).multiplyScalar(lr);
          out.applyAxisAngle(V(1, 0, 0), tiltX);
          out.add(c);
          const [uu, vv] = headDirToUV(out.x / R.x, out.y / R.y, out.z / R.z);
          o.u = uu;
          o.v = vv;
        },
        { thetaStart: th0, thetaEnd: th1, phiStart: -1.7, phiEnd: 1.7, center: c },
      );
    parts.push(lidFn(0, 1.32, 0.08)); // upper lid edge slightly above centre
    parts.push(lidFn(2.05, Math.PI, 0));
  }
  return parts;
}

/** eyeballs as one rigid mesh (head-bone space) */
export function buildEyes(dims, store) {
  const R = dims.headR;
  const k = dims.k;
  const parts = [];
  for (const side of [1, -1]) {
    const c = eyeCenter(R, side);
    const p = spherePart(20, 14, (d, u, v, out) => out.copy(d).multiplyScalar(EYE_R * k), {});
    // aim slightly outward/down for a relaxed gaze
    p.transform(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.06, side * 0.05, 0)));
    p.translate(c.x, c.y, c.z);
    parts.push(p);
  }
  const geo = buildGeometry(parts, false);
  geo.translate(dims.headC.x, dims.headC.y, dims.headC.z);
  const tex = paintEyes();
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.12, metalness: 0 });
  store.geos.push(geo);
  store.mats.push(mat);
  store.texs.push(tex);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'eyes';
  return mesh;
}

// ------------------------------------------------------------------ limbs
function setUV(part, u, v) {
  for (let i = 0; i < part.uv.length; i += 2) {
    part.uv[i] = u + (i % 7) * 0.004;
    part.uv[i + 1] = v + (i % 5) * 0.003;
  }
  return part;
}

/** arm skin tube (left arm, bind space) from s0 to s1 (meters along the arm from the shoulder joint) */
export function armRings(rig, s0, s1, radiusFn, n = 18) {
  const d = rig.dims;
  const sh = rig.bindPos.upperArmL;
  const a = d.armBind;
  const dir = V(Math.sin(a), -Math.cos(a), 0);
  const ax = V(Math.cos(a), Math.sin(a), 0);
  const az = V(0, 0, 1);
  const L1 = d.upperArm;
  const L2 = d.forearm;
  const rings = [];
  for (let j = 0; j <= n; j++) {
    const s = s0 + ((s1 - s0) * j) / n;
    const r = radiusFn(s);
    let w;
    if (s < 0.06 * d.k) w = blendW(W1('clavL'), W1('upperArmL'), smoothstep(-0.03 * d.k, 0.06 * d.k, s));
    else if (s < L1 + 0.04 * d.k) w = blendW(W1('upperArmL'), W1('forearmL'), smoothstep(L1 - 0.03 * d.k, L1 + 0.04 * d.k, s));
    else w = blendW(W1('forearmL'), W1('handL'), smoothstep(L1 + L2 - 0.02 * d.k, L1 + L2 + 0.02 * d.k, s));
    rings.push({
      c: sh.clone().addScaledVector(dir, s),
      ax,
      az,
      rx: r.rx ?? r.r,
      rzF: r.rzF ?? r.r,
      rzB: r.rzB ?? r.r,
      w,
    });
  }
  return rings;
}

/** natural arm radius profile (meters) by distance from the shoulder joint */
export function armRadius(dims, s) {
  const k = dims.k;
  const g = dims.limbG;
  const L1 = dims.upperArm;
  const L2 = dims.forearm;
  const t = s / k;
  let r;
  if (s < 0) r = Math.sqrt(Math.max(0, 1 - (t / 0.055) ** 2)) * 0.05; // shoulder dome
  else if (s < L1) r = 0.05 - 0.012 * smoothstep(0.02, L1 / k, t) + 0.004 * Math.sin((t / (L1 / k)) * Math.PI);
  else if (s < L1 + L2) {
    const u = (s - L1) / L2;
    r = 0.037 + 0.008 * Math.sin(Math.min(1, u * 2.2) * Math.PI * 0.85) - 0.012 * smoothstep(0.35, 1, u);
  } else r = 0.026;
  return { r: r * k * g, rzF: r * k * g * 0.95, rzB: r * k * g * 1.0, rx: r * k * g * 0.92 };
}

export function legRings(rig, y0, y1, radiusFn, n = 24, side = 1) {
  const d = rig.dims;
  const hip = rig.bindPos.thighL;
  const ank = rig.bindPos.footL;
  const knee = rig.bindPos.shinL;
  const rings = [];
  for (let j = 0; j <= n; j++) {
    const y = y0 + ((y1 - y0) * j) / n; // y in bind space (descending)
    const r = radiusFn(y);
    let w;
    if (y > hip.y - 0.1 * d.k) w = blendW(W1('pelvis'), W1('thighL'), smoothstep(hip.y + 0.06 * d.k, hip.y - 0.1 * d.k, y));
    else if (y > knee.y - 0.05 * d.k) w = blendW(W1('thighL'), W1('shinL'), smoothstep(knee.y + 0.05 * d.k, knee.y - 0.05 * d.k, y));
    else w = blendW(W1('shinL'), W1('footL'), smoothstep(ank.y + 0.02 * d.k, ank.y - 0.03 * d.k, y));
    // centre: straight line hip -> ankle (x slightly inward at the knee)
    const t = clamp((hip.y - y) / (hip.y - ank.y), -0.2, 1.2);
    const c = V(hip.x + (ank.x - hip.x) * t, y, hip.z + (ank.z - hip.z) * t + (r.cz || 0));
    if (r.cx) c.x += r.cx;
    rings.push({ c, ax: V(1, 0, 0), az: V(0, 0, 1), rx: r.rx, rzF: r.rzF, rzB: r.rzB, pw: r.pw, w });
  }
  // descending y: reverse so v increases downward? keep order top->bottom
  return rings;
}

export function legRadius(dims, y) {
  const k = dims.k;
  const g = dims.limbG;
  const t = y / k; // height in canonical meters
  // keyed profile: [height, rx, rzF, rzB]
  const keys = [
    [0.02, 0.026, 0.03, 0.03],
    [0.09, 0.03, 0.032, 0.036],
    [0.2, 0.037, 0.04, 0.046],
    [0.36, 0.047, 0.044, 0.06], // calf
    [0.5, 0.045, 0.048, 0.046], // knee
    [0.62, 0.058, 0.058, 0.058],
    [0.8, 0.07, 0.068, 0.07],
    [0.95, 0.08, 0.072, 0.08],
    [1.05, 0.085, 0.07, 0.085],
  ];
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const u = smoothstep(a[0], b[0], t);
  const f = (n) => (a[n] + (b[n] - a[n]) * u) * k * g;
  return { rx: f(1), rzF: f(2), rzB: f(3) };
}

// ------------------------------------------------------------------ hands
/** left hand in hand-bone space: fingers along -Y, palm faces -X, thumb toward +Z */
export function handParts(dims, curl = 0.45) {
  const k = dims.k;
  const g = 0.9 + 0.2 * dims.b;
  const parts = [];
  const palm = spherePart(16, 12, (d, u, v, out) => {
    const x = d.x * 0.0145 * g * (d.x < 0 ? 0.9 : 1.05);
    const y = d.y * 0.048;
    const z = d.z * 0.041 * g * (1 - 0.15 * Math.max(0, d.y));
    out.set(x, y - 0.046, z + 0.002).multiplyScalar(k);
  });
  parts.push(palm);
  const fingers = [
    [0.026, 0.074, 0.0088],
    [0.009, 0.082, 0.0092],
    [-0.009, 0.078, 0.0088],
    [-0.025, 0.063, 0.0078],
  ];
  for (const [fz, len, rad] of fingers) {
    const pts = [];
    let p = V(-0.0015, -0.072, fz * 0.95);
    let dir = V(0, -1, 0);
    const seg = [len * 0.45, len * 0.32, len * 0.28];
    pts.push(p.clone());
    for (let s = 0; s < 3; s++) {
      dir.applyAxisAngle(V(0, 0, 1), curl * (s === 0 ? 0.6 : 1)).normalize();
      // the axis: curling toward -X (palm). rotation about +Z by +a turns -Y toward +X; use negative
      const n = 3;
      for (let i = 1; i <= n; i++) pts.push(p.clone().addScaledVector(dir, (seg[s] * i) / n));
      p = pts[pts.length - 1].clone();
    }
    // mirror x because rotation sign above curls toward +X; we want -X (palm side)
    for (const q of pts) q.x = -q.x;
    const part = pathTubePart(
      pts.map((q) => q.multiplyScalar(k)),
      (t) => rad * k * g * (t > 0.85 ? Math.sqrt(Math.max(0.0, 1 - ((t - 0.85) / 0.15) ** 2)) : 1 - 0.18 * t),
      7,
    );
    parts.push(part);
  }
  // thumb
  {
    const pts = [V(-0.006, -0.018, 0.026), V(-0.014, -0.038, 0.042), V(-0.022, -0.057, 0.05), V(-0.03, -0.073, 0.051)];
    const part = pathTubePart(
      pts.map((q) => q.multiplyScalar(k)),
      (t) => 0.0115 * k * g * (t > 0.82 ? Math.sqrt(Math.max(0, 1 - ((t - 0.82) / 0.18) ** 2)) : 1 - 0.15 * t),
      7,
    );
    parts.push(part);
  }
  return parts;
}

// ------------------------------------------------------------------ skin mesh
/**
 * Builds the skinned skin mesh.  opts: { armFrom: meters from shoulder where the visible arm starts (inside the
 * sleeve), legs: bool (shorts), legTo: y where the legs end (inside socks) }
 */
export function buildSkin(rig, app, opts, store) {
  const d = rig.dims;
  const k = d.k;
  const parts = [];
  // head (head-centred -> bind space)
  const hc = rig.bindPos.head.clone().add(d.headC);
  for (const p of headParts(d)) {
    p.translate(hc.x, hc.y, hc.z);
    p.setWeights(W1('head'));
    parts.push(p);
  }
  // neck
  {
    const nb = rig.bindPos.neck;
    const rings = [];
    const n = 10;
    for (let j = 0; j <= n; j++) {
      const t = j / n;
      const y = nb.y - 0.07 * k + t * 0.2 * k;
      const r = 0.054 * k * (0.92 + 0.12 * d.b) * (1 + 0.12 * smoothstep(0.35, 0, t));
      const w =
        t < 0.4
          ? blendW(W1('chest'), W1('neck'), smoothstep(0.1, 0.4, t))
          : blendW(W1('neck'), W1('head'), smoothstep(0.55, 0.8, t));
      rings.push({ c: V(0, y, nb.z + 0.012 * k + 0.02 * k * t), ax: V(1, 0, 0), az: V(0, 0, 1), rx: r, rzF: r * 0.98, rzB: r * 0.9, w });
    }
    parts.push(setUV(tubePart(rings, 20), ...BODY_UV));
  }
  // arms + hands
  const armFrom = opts.armFrom ?? -0.06 * k;
  const L = d.upperArm + d.forearm;
  const arm = tubePart(
    armRings(rig, armFrom, L + 0.02 * k, (s) => armRadius(d, s), 26),
    16,
  );
  setUV(arm, ...BODY_UV);
  const hand = new Part();
  for (const p of handParts(d)) hand.append(p);
  hand.transform(rig.bindWorld.handL);
  hand.setWeights(W1('handL'));
  setUV(hand, ...BODY_UV);
  parts.push(arm, arm.mirrored(), hand, hand.mirrored());
  // legs (shorts)
  if (opts.legs) {
    const hip = rig.bindPos.thighL;
    const leg = tubePart(legRings(rig, opts.legFrom ?? hip.y - 0.25 * k, opts.legTo ?? 0.05 * k, (y) => legRadius(d, y), 24), 16);
    setUV(leg, ...BODY_UV);
    parts.push(leg, leg.mirrored());
  }
  const geo = buildGeometry(parts, true);
  const tex = paintSkin(app, d.headR, { facialHair: app.facialHair, hairColor: app.hairColor, hairStyle: app.hairStyle });
  const mat = new THREE.MeshPhysicalMaterial({
    map: tex,
    roughness: 0.6,
    sheen: 0.35,
    sheenRoughness: 0.55,
    sheenColor: new THREE.Color(app.skin).lerp(new THREE.Color('#ff8866'), 0.5).multiplyScalar(0.6),
  });
  store.geos.push(geo);
  store.mats.push(mat);
  store.texs.push(tex);
  return { geo, mat };
}

export { gridPart };
