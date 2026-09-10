import * as THREE from 'three';
import { FlightModel } from './FlightModel';
import { AircraftConfig, CESSNA } from './AircraftConfig';
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
  /**
   * Free look, radians off the boresight, and the zoom. Set by the input each frame.
   * Looking around is the one thing a cockpit view needs that a fixed camera cannot
   * give: the canopy exists to be looked out of sideways.
   */
  lookYaw = 0;
  lookPitch = 0;
  zoom = 0;
  private zoomK = 0;
  private shake = 0;
  private shakeVec = new THREE.Vector3();
  private headLag = new THREE.Vector3();
  private t = 0;
  private lookTarget = new THREE.Vector3();
  private initialised = false;
  private tmpQ = new THREE.Quaternion();
  /** The aircraft's nose is +Z, a Three.js camera looks down -Z: hence the half turn. */
  private static readonly NOSE_TO_VIEW = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

  config: AircraftConfig = CESSNA;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 60000);
  }

  setConfig(config: AircraftConfig) {
    this.config = config;
    this.initialised = false;
    this.orbit.dist = Math.max(12, config.chaseDistance * 1.2);
  }

  next() {
    this.mode = this.mode === 'chase' ? 'cockpit' : this.mode === 'cockpit' ? 'orbit' : 'chase';
  }

  addShake(amount: number) { this.shake = Math.min(1.5, this.shake + amount); }

  /** Turn the pilot's head without turning the aircraft. */
  private applyLook(cam: THREE.PerspectiveCamera) {
    if (Math.abs(this.lookYaw) < 1e-4 && Math.abs(this.lookPitch) < 1e-4) return;
    this.tmpQ.setFromEuler(new THREE.Euler(this.lookPitch, this.lookYaw, 0, 'YXZ'));
    cam.quaternion.multiply(this.tmpQ);
    cam.up.set(0, 1, 0).applyQuaternion(cam.quaternion);
  }

  /** Narrow the field of view smoothly rather than snapping to a magnified view. */
  private zoomed(fov: number) {
    this.zoomK += (this.zoom - this.zoomK) * 0.14;
    return fov * (1 - 0.55 * this.zoomK);
  }

  update(dt: number, fm: FlightModel, orbitDelta: { x: number; y: number; zoom: number }, turbulence: number) {
    this.t += dt;
    const s = fm.state;
    const cfg = this.config;
    const speedN = clamp(s.airspeed / cfg.refSpeed, 0, 1.4);
    // Continuous shake: airspeed + turbulence + stall buffet + rolling on the ground
    const groundRumble = s.onGround ? clamp(s.groundSpeed / 30, 0, 1) * (fm.onRunway(fm.position.x, fm.position.z) ? 0.25 : 0.9) : 0;
    // Reheat shakes the airframe; so does the buffet at the edge of the envelope.
    const base = 0.0035 * speedN * speedN + 0.012 * turbulence + 0.02 * s.stall
      + 0.012 * groundRumble + 0.010 * s.afterburner + 0.03 * s.overG;
    this.shake = Math.max(base, this.shake * Math.exp(-dt * 4));
    const n1 = Math.sin(this.t * 37.1) * Math.sin(this.t * 11.3 + 1.7), n2 = Math.sin(this.t * 29.7 + 0.5) * Math.cos(this.t * 8.1), n3 = Math.sin(this.t * 43.3 + 2.1);
    this.shakeVec.set(n1, n2, n3).multiplyScalar(this.shake);

    const pos = fm.position, q = fm.quaternion;
    // Snap on the first frame instead of springing in from the world origin.
    if (!this.initialised) { this.initialised = true; this.chasePos.set(0, 0, 0); this.lookTarget.copy(pos).addScaledVector(fm.forward, 20); }
    const fwd = fm.forward, up = fm.up;
    const cam = this.camera;

    if (this.mode === 'cockpit') {
      // Head inertia: the eye lags accelerations slightly.
      const accelBody = new THREE.Vector3(0, (s.gLoad - 1) * -0.03, 0);
      this.headLag.lerp(accelBody, 1 - Math.exp(-dt * 6));
      const eye = this.pilotEye.clone().add(this.headLag).add(this.shakeVec.clone().multiplyScalar(0.25));
      cam.position.copy(eye.applyQuaternion(q).add(pos));
      cam.quaternion.copy(q).multiply(CameraRig.NOSE_TO_VIEW);
      cam.up.set(0, 1, 0).applyQuaternion(cam.quaternion);
      // slight view shake rotation
      this.tmpQ.setFromEuler(new THREE.Euler(this.shakeVec.x * 0.012, this.shakeVec.y * 0.012, this.shakeVec.z * 0.008));
      cam.quaternion.multiply(this.tmpQ);
      this.applyLook(cam);
      cam.fov = lerp(cam.fov, this.zoomed(68 + 6 * s.afterburner), 0.1);
    } else if (this.mode === 'chase') {
      const dist = cfg.chaseDistance * (1 + 0.28 * speedN);
      const height = cfg.chaseHeight * (1 + 0.28 * speedN);
      // Target: behind & above, using a horizon-stabilised up so the camera does not roll fully with the aircraft
      const flatFwd = new THREE.Vector3(fwd.x, fwd.y * 0.35, fwd.z).normalize();
      const target = pos.clone().addScaledVector(flatFwd, -dist).addScaledVector(new THREE.Vector3(0, 1, 0), height);
      const k = 1 - Math.exp(-dt * (s.onGround ? 4 : 2.6));
      if (this.chasePos.lengthSq() === 0) this.chasePos.copy(target);
      // Carry the camera along at the aircraft's own velocity before relaxing toward
      // the ideal offset. A plain lerp on to a moving target settles at a lag of
      // speed / rate, which is 27 m on the trainer and over 100 m on the fighter: the
      // aircraft shrinks to a dot exactly when the flying gets interesting. Advancing
      // first leaves the smoothing to act on the offset alone, so the framing holds at
      // any speed and the spring still absorbs manoeuvres.
      this.chasePos.addScaledVector(fm.velocity, dt);
      this.chasePos.lerp(target, k);
      // camera roll: a fraction of the aircraft bank, lagging
      const desiredUp = new THREE.Vector3(0, 1, 0).lerp(up, 0.35).normalize();
      this.chaseUp.lerp(desiredUp, 1 - Math.exp(-dt * 2)).normalize();
      cam.position.copy(this.chasePos).add(this.shakeVec.clone().multiplyScalar(0.6));
      // Look ahead of the aircraft, but not so far that the aircraft itself drops out
      // of the lower edge of the frame — which is what happens on a fast jet if the
      // look-ahead scales with the chase distance as freely as it can on a trainer.
      const lookAhead = cfg.chaseDistance * (0.8 + 0.9 * speedN);
      this.lookTarget.addScaledVector(fm.velocity, dt);   // same reason as the position
      this.lookTarget.lerp(
        pos.clone().addScaledVector(fwd, lookAhead).addScaledVector(fm.velocity, 0.08),
        1 - Math.exp(-dt * 5));
      cam.up.copy(this.chaseUp);
      cam.lookAt(this.lookTarget);
      // Field of view opens with speed, and again when the reheat lights — the visual
      // shorthand for acceleration that every fast game uses, kept subtle enough to
      // feel like pressure rather than a zoom.
      // speedN runs to 1.4, so squaring it unclamped took the fighter to a 112 degree
      // fish-eye in reheat and shrank the aircraft to a smudge. The widening is a speed
      // cue, not a zoom out: cap it at the reference speed and keep the reheat kick small.
      const fovN = Math.min(1, speedN);
      const fov = cfg.fovBase + cfg.fovSpeed * fovN * fovN + 5 * s.afterburner;
      cam.fov = lerp(cam.fov, this.zoomed(fov), 1 - Math.exp(-dt * 2));
      // The chase view swings round the aircraft rather than turning the head.
      if (Math.abs(this.lookYaw) > 1e-3 || Math.abs(this.lookPitch) > 1e-3) {
        this.tmpQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.lookYaw);
        const off = cam.position.clone().sub(pos).applyQuaternion(this.tmpQ);
        this.tmpQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0).cross(off).normalize(), this.lookPitch);
        cam.position.copy(pos).add(off.applyQuaternion(this.tmpQ));
        cam.lookAt(this.lookTarget);
      }
    } else {
      this.orbit.theta -= orbitDelta.x * 0.005;
      this.orbit.phi = clamp(this.orbit.phi - orbitDelta.y * 0.005, 0.15, Math.PI - 0.2);
      this.orbit.dist = clamp(this.orbit.dist * (1 + orbitDelta.zoom * 0.001), 5, 120);
      const o = this.orbit;
      const off = new THREE.Vector3(Math.sin(o.phi) * Math.sin(o.theta), Math.cos(o.phi), Math.sin(o.phi) * Math.cos(o.theta)).multiplyScalar(o.dist);
      cam.position.copy(pos).add(off).add(this.shakeVec.clone().multiplyScalar(0.3));
      cam.up.set(0, 1, 0);
      cam.lookAt(pos);
      cam.fov = lerp(cam.fov, this.zoomed(50), 0.1);
    }
    // never go underground
    cam.updateProjectionMatrix();
  }
}
