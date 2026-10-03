import * as THREE from 'three';
import { BOARD } from '../core/constants.js';
import { DEFAULT_APPEARANCE } from '../core/customization.js';

// Lightweight stand-in skater for the demo build: simple shapes, 2-bone leg IK, rigid tumble on bail.

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

function limb(r) {
  const g = new THREE.CapsuleGeometry(r, 1, 6, 12);
  return g;
}

export class Skater {
  constructor(appearance = DEFAULT_APPEARANCE) {
    this.object3d = new THREE.Group();
    this.body = new THREE.Group();
    this.object3d.add(this.body);
    this.mats = {
      skin: new THREE.MeshStandardMaterial({ roughness: 0.6 }),
      top: new THREE.MeshStandardMaterial({ roughness: 0.85 }),
      bottom: new THREE.MeshStandardMaterial({ roughness: 0.9 }),
      shoe: new THREE.MeshStandardMaterial({ roughness: 0.7 }),
      hair: new THREE.MeshStandardMaterial({ roughness: 0.8 }),
      hat: new THREE.MeshStandardMaterial({ roughness: 0.85 }),
    };
    const M = (g, m) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = true;
      this.body.add(mesh);
      return mesh;
    };
    this.parts = {
      torso: M(new THREE.CapsuleGeometry(0.17, 0.42, 6, 14), this.mats.top),
      head: M(new THREE.SphereGeometry(0.115, 20, 16), this.mats.skin),
      hat: M(new THREE.SphereGeometry(0.12, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), this.mats.hat),
      thighL: M(limb(0.075), this.mats.bottom),
      thighR: M(limb(0.075), this.mats.bottom),
      shinL: M(limb(0.065), this.mats.bottom),
      shinR: M(limb(0.065), this.mats.bottom),
      footL: M(new THREE.BoxGeometry(0.11, 0.07, 0.28), this.mats.shoe),
      footR: M(new THREE.BoxGeometry(0.11, 0.07, 0.28), this.mats.shoe),
      armL: M(limb(0.05), this.mats.top),
      armR: M(limb(0.05), this.mats.top),
      foreL: M(limb(0.045), this.mats.skin),
      foreR: M(limb(0.045), this.mats.skin),
    };
    this.isRagdoll = false;
    this.rag = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), quat: new THREE.Quaternion(), ang: new THREE.Vector3(), collide: null };
    this.sm = { crouch: 0, lean: 0, push: 0, tuck: 0 };
    this.setAppearance(appearance);
  }

  setAppearance(a) {
    a = { ...DEFAULT_APPEARANCE, ...a };
    this.mats.skin.color.set(a.skin);
    this.mats.top.color.set(a.topColor);
    this.mats.bottom.color.set(a.bottomColor);
    this.mats.shoe.color.set(a.shoeColor);
    this.mats.hat.color.set(a.headwear === 'none' ? a.hairColor : a.headwearColor);
    this.parts.hat.visible = a.hairStyle !== 'bald' || a.headwear !== 'none';
    const s = 0.93 + a.height * 0.14;
    this.body.scale.setScalar(s);
  }

  _place(mesh, a, b) {
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    const d = _s.subVectors(b, a);
    const len = d.length();
    mesh.quaternion.setFromUnitVectors(UP, d.divideScalar(len || 1));
    mesh.scale.set(1, Math.max(0.01, len - 0.1), 1);
  }

  // two-bone IK in the body's local space; bend toward `pole`
  _leg(thigh, shin, foot, hip, ankle, pole) {
    const L1 = 0.45, L2 = 0.45;
    const d = _a.subVectors(ankle, hip);
    let dist = Math.min(d.length(), L1 + L2 - 0.001);
    d.normalize();
    const along = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(0, L1 * L1 - along * along));
    const bend = _b.copy(pole).addScaledVector(d, -pole.dot(d)).normalize();
    const knee = hip.clone().addScaledVector(d, along).addScaledVector(bend, h);
    this._place(thigh, hip, knee);
    this._place(shin, knee, ankle);
    foot.position.copy(ankle).add(new THREE.Vector3(0, -0.02, 0));
    foot.quaternion.identity();
  }

  update(dt, pose) {
    if (this.isRagdoll) return;
    const sm = this.sm;
    const k = 1 - Math.exp(-12 * dt);
    sm.crouch += (pose.crouch - sm.crouch) * k;
    sm.lean += (pose.lean - sm.lean) * k;
    sm.tuck += (pose.tuck - sm.tuck) * k;
    pose.rider.decompose(this.object3d.position, this.object3d.quaternion, _s);
    this.object3d.scale.set(1, 1, 1);
    const chest = pose.stance === 'regular' ? -1 : 1; // chest faces -X (regular) / +X (goofy)
    const deck = BOARD.deckTopY;
    // feet on board (in rider frame); during flips they hover
    let fy = deck + 0.035;
    if (!pose.feetOnBoard) fy += 0.12 + sm.tuck * 0.1;
    const backZ = pose.crouch > 0.6 ? BOARD.backFootPopZ : BOARD.backFootZ;
    const fFront = new THREE.Vector3(0, fy, BOARD.frontFootZ);
    const fBack = new THREE.Vector3(0, fy, backZ);
    if (pose.state === 'push') {
      // back foot steps down beside the board and pushes back
      const p = pose.pushPhase;
      const down = p > 0.2 && p < 0.65;
      const z = down ? 0.25 - (p - 0.2) * 1.6 : p < 0.2 ? -0.2 + p * 2 : -0.47 + (p - 0.65) * 0.8;
      fBack.set(chest * -0.18, down ? 0.05 : 0.18, z);
    }
    if (!pose.feetOnBoard && pose.flick) fFront.x += pose.flick * 0.15 * Math.sin(Math.min(1, pose.flickT) * Math.PI);
    const crouch = Math.max(sm.crouch, sm.tuck * 0.7);
    const hipY = deck + 0.95 - crouch * 0.38;
    const leanX = -sm.lean * 0.12;
    const hip = new THREE.Vector3(leanX + chest * -0.02, hipY, 0);
    const hipF = hip.clone().add(new THREE.Vector3(0, 0, 0.1));
    const hipB = hip.clone().add(new THREE.Vector3(0, 0, -0.1));
    const pole = new THREE.Vector3(chest, 0, 0);
    const P = this.parts;
    this._leg(P.thighL, P.shinL, P.footL, hipF, fFront, pole);
    this._leg(P.thighR, P.shinR, P.footR, hipB, fBack, pole);
    // torso leans forward a bit with crouch
    const shoulder = hip.clone().add(new THREE.Vector3(chest * (0.08 + crouch * 0.18), 0.52, 0));
    this._place(P.torso, hip.clone().add(new THREE.Vector3(0, 0.08, 0)), shoulder);
    P.torso.scale.set(1, 1, 1);
    P.head.position.copy(shoulder).add(new THREE.Vector3(chest * 0.03, 0.2, 0.02));
    P.hat.position.copy(P.head.position).add(new THREE.Vector3(0, 0.02, 0));
    // arms out for balance, swinging with lean / spins
    const swing = pose.armSwing || 0;
    const t = pose.time || 0;
    const sway = Math.sin(t * 2.1) * 0.04;
    const shF = shoulder.clone().add(new THREE.Vector3(0, -0.03, 0.17));
    const shB = shoulder.clone().add(new THREE.Vector3(0, -0.03, -0.17));
    const elF = shF.clone().add(new THREE.Vector3(chest * 0.05 + swing * 0.1, -0.2 + sway, 0.2));
    const elB = shB.clone().add(new THREE.Vector3(chest * 0.05 - swing * 0.1, -0.22 - sway, -0.2));
    let haF = elF.clone().add(new THREE.Vector3(chest * 0.08, -0.15, 0.15));
    let haB = elB.clone().add(new THREE.Vector3(chest * 0.08, -0.12, -0.15));
    if (pose.state === 'air') {
      elF.y += 0.15;
      elB.y += 0.15;
      haF.y += 0.25;
      haB.y += 0.25;
    }
    if (pose.grab) {
      // reach toward the board edge
      const edge = new THREE.Vector3(pose.grab === 'melon' || pose.grab === 'stalefish' ? -chest * 0.1 : chest * 0.1, deck + 0.05, pose.grab === 'nose' ? 0.35 : pose.grab === 'tail' ? -0.35 : 0);
      if (pose.grab === 'melon' || pose.grab === 'nose') haF = edge;
      else haB = edge;
    }
    this._place(P.armL, shF, elF);
    this._place(P.foreL, elF, haF);
    this._place(P.armR, shB, elB);
    this._place(P.foreR, elB, haB);
    this.body.rotation.set(0, 0, 0);
  }

  bail(velocity, spin, collide) {
    this.isRagdoll = true;
    const r = this.rag;
    this.object3d.updateMatrixWorld(true);
    r.pos.copy(this.object3d.position).add(new THREE.Vector3(0, 0.9, 0).applyQuaternion(this.object3d.quaternion));
    r.quat.copy(this.object3d.quaternion);
    r.vel.copy(velocity).multiplyScalar(0.9);
    r.vel.y += 1.2;
    r.ang.copy(spin);
    r.collide = collide;
    this.body.position.set(0, -0.9, 0);
  }

  updateRagdoll(dt) {
    if (!this.isRagdoll) return;
    const r = this.rag;
    const n = 4;
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      r.vel.y -= 9.81 * 1.12 * h;
      r.pos.addScaledVector(r.vel, h);
      const c = r.collide?.(r.pos, 0.35);
      if (c) {
        r.pos.addScaledVector(c.normal, c.depth);
        const vn = r.vel.dot(c.normal);
        if (vn < 0) r.vel.addScaledVector(c.normal, -vn * 1.25);
        r.vel.multiplyScalar(Math.exp(-6 * h));
        r.ang.multiplyScalar(Math.exp(-5 * h));
      }
      const al = r.ang.length();
      if (al > 1e-4) {
        _q.setFromAxisAngle(_a.copy(r.ang).divideScalar(al), al * h);
        r.quat.premultiply(_q);
      }
    }
    this.object3d.position.copy(r.pos);
    this.object3d.quaternion.copy(r.quat);
  }

  getRagdollCenter(target) {
    return target.copy(this.rag.pos);
  }

  endRagdoll() {
    this.isRagdoll = false;
    this.body.position.set(0, 0, 0);
  }
}
