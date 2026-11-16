// First-person controller (Rapier kinematic character controller) + cinematic camera shake/kick.
import * as THREE from 'three';
import { G } from '../core/globals.js';
import { clamp, damp, Spring } from '../core/util.js';
import { ARENA, SPAWN } from '../world/layout.js';

const EYE = 1.66, CAP_HH = 0.5, CAP_R = 0.34;

export class Player {
  constructor() {
    this.pos = new THREE.Vector3(SPAWN.x, 0, SPAWN.z); // feet
    this.vel = new THREE.Vector3();
    this.yaw = THREE.MathUtils.degToRad(SPAWN.yaw); this.pitch = THREE.MathUtils.degToRad(SPAWN.pitch); this.grounded = true;
    this.trauma = 0; this.bobT = 0; this.bobAmp = 0;
    this.fov = 70; this.fovKick = new Spring(0, 5, 0.75);
    this.recoil = new Spring(0, 7, 0.6); this.roll = 0;
    this.forward = new THREE.Vector3(0, 0, -1); this.right = new THREE.Vector3(1, 0, 0);
    this.eye = new THREE.Vector3();
  }
  init() {
    const P = G.physics, R = P.RAPIER;
    this.pos.y = G.terrain.heightAt(this.pos.x, this.pos.z);
    this.body = P.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(this.pos.x, this.pos.y + CAP_HH + CAP_R, this.pos.z));
    this.collider = P.world.createCollider(R.ColliderDesc.capsule(CAP_HH, CAP_R).setCollisionGroups(P.GROUP_PLAYER), this.body);
    const cc = this.cc = P.world.createCharacterController(0.04);
    cc.setUp({ x: 0, y: 1, z: 0 });
    cc.setMaxSlopeClimbAngle(THREE.MathUtils.degToRad(52)); cc.setMinSlopeSlideAngle(THREE.MathUtils.degToRad(42));
    cc.enableAutostep(0.5, 0.25, true); cc.enableSnapToGround(0.45);
    cc.setApplyImpulsesToDynamicBodies(true); cc.setCharacterMass?.(3);
  }
  teleport(x, z, yawDeg = null, pitchDeg = null) {
    this.pos.set(x, G.terrain.heightAt(x, z), z); this.vel.set(0, 0, 0);
    this.body.setTranslation({ x, y: this.pos.y + CAP_HH + CAP_R, z }, true);
    if (yawDeg !== null) this.yaw = THREE.MathUtils.degToRad(yawDeg);
    if (pitchDeg !== null) this.pitch = THREE.MathUtils.degToRad(pitchDeg);
    G.post?.cutBlur();
  }
  addTrauma(x) { this.trauma = Math.min(1.25, this.trauma + x); }
  // shake from a world event, attenuated by distance
  shakeFrom(pos, power, range = 60) {
    const d = pos.distanceTo(this.eye);
    const k = clamp(1 - d / range, 0, 1);
    this.addTrauma(power * k * k);
  }

  update(dt, realDt) {
    const inp = G.input, cam = G.camera;
    const [lx, ly] = inp.consumeLook();
    this.yaw -= lx; this.pitch = clamp(this.pitch - ly, -1.45, 1.45);
    if (this.lookOverride) { this.yaw = this.lookOverride.yaw; this.pitch = this.lookOverride.pitch; }
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    this.forward.set(-sy * Math.cos(this.pitch), Math.sin(this.pitch), -cy * Math.cos(this.pitch));
    this.right.set(cy, 0, -sy);
    if (dt > 0) {
      let mx = inp.moveX, mz = inp.moveZ; const l = Math.hypot(mx, mz); if (l > 1) { mx /= l; mz /= l; }
      // water: wading slows you down, a current carries you along, and deep water floats you
      const wat = !this.fly && G.water ? G.water.at(this.pos.x, this.pos.z) : null;
      const wet = wat && wat.frozen < 0.5 ? Math.max(0, wat.level - this.pos.y) : 0;          // depth of water above the feet
      const speed = (this.fly ? (inp.sprint ? 60 : 24) : inp.sprint ? 9.5 : 5.4) * (1 - 0.5 * Math.min(1, wet / 1.3));
      const carry = Math.min(1, wet / 1.0) * 0.9;
      const wx = (cy * mx - sy * mz) * speed + (wat ? wat.vx * carry : 0), wz = (-sy * mx - cy * mz) * speed + (wat ? wat.vz * carry : 0);
      this.inWater = wet;
      const acc = this.fly ? 4 : this.grounded ? 12 : 3;
      this.vel.x = damp(this.vel.x, wx, acc, dt); this.vel.z = damp(this.vel.z, wz, acc, dt);
      if (this.fly) this.vel.y = damp(this.vel.y, inp.moveY * (inp.sprint ? 30 : 14) + this.forward.y * mz * speed * 0.9, 5, dt);
      else if (wet > 1.3) this.vel.y = damp(this.vel.y, Math.min(4, (wet - 1.3) * 5), 6, dt);     // swimming: bob at chest height
      else { this.vel.y -= 22 * dt; if (this.grounded && this.vel.y < 0) this.vel.y = -2; }
      if (this.wantJump && (this.grounded || wet > 1.1)) { this.vel.y = 7.6; this.grounded = false; }
      this.wantJump = false;
      const des = { x: this.vel.x * dt, y: this.vel.y * dt, z: this.vel.z * dt };
      this.cc.computeColliderMovement(this.collider, des, undefined, G.physics.GROUP_PLAYER);
      const m = this.cc.computedMovement(); this.grounded = this.cc.computedGrounded();
      const t = this.body.translation();
      let nx = t.x + m.x, ny = t.y + m.y, nz = t.z + m.z;
      const ax = nx - ARENA.x, az = nz - ARENA.z, r = Math.hypot(ax, az);
      if (r > ARENA.r) { nx = ARENA.x + ax * ARENA.r / r; nz = ARENA.z + az * ARENA.r / r; }
      // never sink under the (possibly just-deformed) terrain
      const gy = G.terrain.heightAt(nx, nz) + CAP_HH + CAP_R;
      if (ny < gy - 0.6) ny = gy;
      this.body.setNextKinematicTranslation({ x: nx, y: ny, z: nz });
      this.pos.set(nx, ny - CAP_HH - CAP_R, nz);
      const hs = Math.hypot(this.vel.x, this.vel.z);
      this.bobAmp = damp(this.bobAmp, this.grounded && !this.fly ? Math.min(1, hs / 6) : 0, 8, dt);
      if (this.fly && ny > 260) ny = 260;
      this.bobT += dt * (5.5 + hs * 0.75);
      this.roll = damp(this.roll, -mx * 0.012 * Math.min(1, hs / 5), 6, dt);
    }
    // ---- camera
    const C = G.cam, bobY = Math.sin(this.bobT * 2) * 0.035 * this.bobAmp * C.bob, bobX = Math.cos(this.bobT) * 0.028 * this.bobAmp * C.bob;
    this.eye.set(this.pos.x + this.right.x * bobX, this.pos.y + EYE + bobY, this.pos.z + this.right.z * bobX);
    this.trauma = Math.max(0, this.trauma - realDt * (0.9 + this.trauma * 0.9));
    const s = this.trauma * this.trauma * C.shake, T = G.realTime;
    const n = (f, o) => Math.sin(T * f + o) * 0.6 + Math.sin(T * f * 2.3 + o * 1.7) * 0.4;
    const shP = n(31, 0.3) * 0.05 * s, shY = n(27, 2.1) * 0.05 * s, shR = n(35, 4.2) * 0.06 * s;
    this.recoil.update(realDt); this.fovKick.update(realDt);
    cam.position.copy(this.eye);
    cam.position.x += n(41, 1.1) * 0.07 * s; cam.position.y += n(37, 5.3) * 0.07 * s;
    cam.rotation.set(this.pitch + shP + this.recoil.x * C.shake, this.yaw + shY, (this.roll + shR) * C.roll, 'YXZ');
    const fov = this.fov + this.fovKick.x * C.fov;
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
  }
}
