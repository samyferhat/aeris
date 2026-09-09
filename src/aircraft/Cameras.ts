import * as THREE from 'three';
import { FlightModel } from './FlightModel';
import { clamp, lerp } from '../core/Noise';

export type CameraMode = 'chase' | 'cockpit' | 'orbit';

/**
 * Three camera behaviours on one PerspectiveCamera:
 *  - cockpit: pilot's eye with subtle head lag and G-induced bob
 *  - chase:   cinematic follow with spring damping, look-ahead and speed-dependent FOV
 *  - orbit:   free orbit around the aircraft (mouse drag + wheel)
 * Plus camera shake driven by speed, turbulence and touchdowns.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'chase';
  pilotEye = new THREE.Vector3(-0.25, 0.62, 0.9);
  private chasePos = new THREE.Vector3();
  private chaseUp = new THREE.Vector3(0, 1, 0);
  orbit = { theta: 0.6, phi: 1.2, dist: 16 };
  private shake = 0;
  private shakeVec = new THREE.Vector3();
  private headLag = new THREE.Vector3();
  private t = 0;
  private lookTarget = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 60000);
  }

  next() {
    this.mode = this.mode === 'chase' ? 'cockpit' : this.mode === 'cockpit' ? 'orbit' : 'chase';
  }

  addShake(amount: number) { this.shake = Math.min(1.5, this.shake + amount); }

  update(dt: number, fm: FlightModel, orbitDelta: { x: number; y: number; zoom: number }, turbulence: number) {
    this.t += dt;
    const s = fm.state;
    const speedN = clamp(s.airspeed / 70, 0, 1.4);
    // Continuous shake: airspeed + turbulence + stall buffet + rolling on the ground
    const groundRumble = s.onGround ? clamp(s.groundSpeed / 30, 0, 1) * (fm.onRunway(fm.position.x, fm.position.z) ? 0.25 : 0.9) : 0;
    const base = 0.0035 * speedN * speedN + 0.012 * turbulence + 0.02 * s.stall + 0.012 * groundRumble;
    this.shake = Math.max(base, this.shake * Math.exp(-dt * 4));
    const n1 = Math.sin(this.t * 37.1) * Math.sin(this.t * 11.3 + 1.7), n2 = Math.sin(this.t * 29.7 + 0.5) * Math.cos(this.t * 8.1), n3 = Math.sin(this.t * 43.3 + 2.1);
    this.shakeVec.set(n1, n2, n3).multiplyScalar(this.shake);

    const pos = fm.position, q = fm.quaternion;
    const fwd = fm.forward, up = fm.up;
    const cam = this.camera;

    if (this.mode === 'cockpit') {
      // Head inertia: the eye lags accelerations slightly.
      const accelBody = new THREE.Vector3(0, (s.gLoad - 1) * -0.03, 0);
      this.headLag.lerp(accelBody, 1 - Math.exp(-dt * 6));
      const eye = this.pilotEye.clone().add(this.headLag).add(this.shakeVec.clone().multiplyScalar(0.25));
      cam.position.copy(eye.applyQuaternion(q).add(pos));
      cam.quaternion.copy(q);
      // slight view shake rotation
      this.tmpQ.setFromEuler(new THREE.Euler(this.shakeVec.x * 0.012, this.shakeVec.y * 0.012, this.shakeVec.z * 0.008));
      cam.quaternion.multiply(this.tmpQ);
      cam.fov = lerp(cam.fov, 68, 0.1);
    } else if (this.mode === 'chase') {
      const dist = 14 + 4 * speedN, height = 4.2 + 1.2 * speedN;
      // Target: behind & above, using a horizon-stabilised up so the camera does not roll fully with the aircraft
      const flatFwd = new THREE.Vector3(fwd.x, fwd.y * 0.35, fwd.z).normalize();
      const target = pos.clone().addScaledVector(flatFwd, -dist).addScaledVector(new THREE.Vector3(0, 1, 0), height);
      const k = 1 - Math.exp(-dt * (s.onGround ? 4 : 2.6));
      if (this.chasePos.lengthSq() === 0) this.chasePos.copy(target);
      this.chasePos.lerp(target, k);
      // camera roll: a fraction of the aircraft bank, lagging
      const desiredUp = new THREE.Vector3(0, 1, 0).lerp(up, 0.35).normalize();
      this.chaseUp.lerp(desiredUp, 1 - Math.exp(-dt * 2)).normalize();
      cam.position.copy(this.chasePos).add(this.shakeVec.clone().multiplyScalar(0.6));
      this.lookTarget.lerp(pos.clone().addScaledVector(fwd, 12 + 30 * speedN).addScaledVector(fm.velocity, 0.15), 1 - Math.exp(-dt * 5));
      cam.up.copy(this.chaseUp);
      cam.lookAt(this.lookTarget);
      cam.fov = lerp(cam.fov, 55 + 18 * speedN * speedN, 1 - Math.exp(-dt * 2));
    } else {
      this.orbit.theta -= orbitDelta.x * 0.005;
      this.orbit.phi = clamp(this.orbit.phi - orbitDelta.y * 0.005, 0.15, Math.PI - 0.2);
      this.orbit.dist = clamp(this.orbit.dist * (1 + orbitDelta.zoom * 0.001), 5, 120);
      const o = this.orbit;
      const off = new THREE.Vector3(Math.sin(o.phi) * Math.sin(o.theta), Math.cos(o.phi), Math.sin(o.phi) * Math.cos(o.theta)).multiplyScalar(o.dist);
      cam.position.copy(pos).add(off).add(this.shakeVec.clone().multiplyScalar(0.3));
      cam.up.set(0, 1, 0);
      cam.lookAt(pos);
      cam.fov = lerp(cam.fov, 50, 0.1);
    }
    // never go underground
    cam.updateProjectionMatrix();
  }
}
