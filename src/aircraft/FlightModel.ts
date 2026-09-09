import * as THREE from 'three';
import { Heightfield } from '../world/Heightfield';
import { Controls } from '../core/Input';
import { clamp, smoothstep, lerp } from '../core/Noise';

/**
 * "Realistic-arcade" 6-DOF flight model of a small single-engine high-wing aircraft.
 *
 * Two frames are in play and mixing them up is the classic source of inverted controls:
 *
 *   MODEL frame (what the glTF and Three.js use): +Z nose, +Y up, +X LEFT wing.
 *   AERO frame  (what the coefficients below are written in, as in every textbook):
 *               x forward, y right, z down; p roll-right, q pitch-up, r yaw-right.
 *
 *   x_aero = +Z_model ; y_aero = -X_model ; z_aero = -Y_model
 *
 * Everything aerodynamic is computed in the aero frame, then rotated back once at the
 * end. Stall is soft, dihedral and weathercock stability let the aircraft settle by
 * itself, and control rates are damped so the inputs feel silky rather than twitchy.
 */
export interface WheelDef { name: string; local: THREE.Vector3; steer: boolean; brake: boolean }
export interface FlightState {
  airspeed: number; groundSpeed: number; alpha: number; beta: number; gLoad: number;
  altitude: number; heightAGL: number; heading: number; pitch: number; bank: number; verticalSpeed: number;
  rpm: number; onGround: boolean; stall: number; throttle: number; flaps: number;
  wheelCompression: number[]; wheelOnGround: boolean[]; wheelSlip: number;
}

const G = 9.81;
const RHO = 1.225;

// Scratch vectors: the integrator runs four times per frame, so it allocates nothing.
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3(), _v6 = new THREE.Vector3();
const _v7 = new THREE.Vector3(), _v8 = new THREE.Vector3(), _v9 = new THREE.Vector3();
const _v10 = new THREE.Vector3(), _v11 = new THREE.Vector3(), _v12 = new THREE.Vector3();
const _v13 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();

export class FlightModel {
  readonly position = new THREE.Vector3();
  readonly quaternion = new THREE.Quaternion();
  readonly velocity = new THREE.Vector3();
  /** body-frame angular velocity (rad/s): x pitch, y yaw, z roll */
  readonly omega = new THREE.Vector3();
  readonly forward = new THREE.Vector3(0, 0, 1);
  readonly up = new THREE.Vector3(0, 1, 0);
  readonly right = new THREE.Vector3(1, 0, 0);

  // Aircraft constants
  mass = 1050; S = 16.2; b = 11.0; c = 1.5; AR = 7.5;
  inertia = new THREE.Vector3(1800, 2500, 1300);
  maxPower = 130000;      // W (arcade-boosted)
  maxThrust = 3100;       // N static

  // Runtime
  flaps = 0;              // 0..1 actual (moves slowly toward target)
  flapsTarget = 0;
  elevator = 0; aileron = 0; rudder = 0; // -1..1 actual (rate limited)
  throttle = 0;
  rpm = 0;
  // Overwritten from the model's Contact_* locators once the glTF is loaded.
  wheels: WheelDef[] = [
    { name: 'nose', local: new THREE.Vector3(0, -0.90, 1.25), steer: true, brake: false },
    { name: 'left', local: new THREE.Vector3(1.25, -0.90, -0.55), steer: false, brake: true },
    { name: 'right', local: new THREE.Vector3(-1.25, -0.90, -0.55), steer: false, brake: true },
  ];
  readonly state: FlightState = {
    airspeed: 0, groundSpeed: 0, alpha: 0, beta: 0, gLoad: 1, altitude: 0, heightAGL: 0, heading: 0, pitch: 0, bank: 0,
    verticalSpeed: 0, rpm: 0, onGround: true, stall: 0, throttle: 0, flaps: 0, wheelCompression: [0, 0, 0], wheelOnGround: [true, true, true], wheelSlip: 0,
  };
  /** Set by the model on a touchdown: vertical speed (m/s, positive down). Consumed by game feel. */
  touchdownEvent = 0;
  private wasOnGround = true;
  private accel = new THREE.Vector3();
  /** Body-frame linear acceleration, exposed for camera shake and the G meter. */
  get bodyAccel() { return this.accel; }
  private lastVel = new THREE.Vector3();
  private crashed = false;

  constructor(private hf: Heightfield) {}

  /** Attach wheel contact points read from the model (body-frame positions). */
  setWheels(defs: WheelDef[]) { this.wheels = defs; this.state.wheelCompression = defs.map(() => 0); this.state.wheelOnGround = defs.map(() => false); }

  resetOnRunway(x: number, z: number, y: number, headingRad: number) {
    this.position.set(x, y + 0.90 + 0.04, z);
    this.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), headingRad);
    this.velocity.set(0, 0, 0); this.omega.set(0, 0, 0);
    this.throttle = 0; this.flaps = 0; this.flapsTarget = 0; this.rpm = 0; this.crashed = false;
    this.lastVel.set(0, 0, 0);
  }

  get isCrashed() { return this.crashed; }

  step(dt: number, ctrl: Controls) {
    const sub = 4, h = dt / sub;
    this.throttle = ctrl.throttle;
    this.flapsTarget = ctrl.flaps;
    // Control surfaces move at a finite rate: no instant full deflection.
    const rate = 4.5 * dt;
    this.elevator += clamp(ctrl.pitch - this.elevator, -rate, rate);
    this.aileron += clamp(ctrl.roll - this.aileron, -rate, rate);
    this.rudder += clamp(ctrl.yaw - this.rudder, -rate, rate);
    this.flaps += clamp(this.flapsTarget - this.flaps, -0.25 * dt, 0.25 * dt);
    for (let i = 0; i < sub; i++) this.integrate(h, ctrl.brake);
    this.updateState(dt);
  }

  private integrate(dt: number, brake: boolean) {
    const q = this.quaternion;
    this.forward.set(0, 0, 1).applyQuaternion(q);
    this.up.set(0, 1, 0).applyQuaternion(q);
    this.right.set(-1, 0, 0).applyQuaternion(q);   // aircraft right = -X in model space
    const invQ = _q1.copy(q).invert();

    // --- air data, in the aero frame -----------------------------------------
    const vModel = _v1.copy(this.velocity).applyQuaternion(invQ);
    const u = vModel.z, v = -vModel.x, w = -vModel.y;   // forward, right, down
    const V = Math.hypot(u, v, w);
    const Vsafe = Math.max(V, 1);
    const alpha = Math.atan2(w, Math.max(u, 0.5));
    const beta = Math.asin(clamp(v / Vsafe, -1, 1));
    const qbar = 0.5 * RHO * V * V;
    // Angular rates in the aero frame.
    const p = this.omega.z, qq = -this.omega.x, r = -this.omega.y;

    // --- lift, drag, side force ----------------------------------------------
    const CL0 = 0.32 + 0.55 * this.flaps;
    const CLa = 5.1;
    const aStall = 0.29 - 0.03 * this.flaps;
    const CLlin = CL0 + CLa * alpha;
    // Past the stall the curve rolls over instead of dropping off a cliff: the
    // aircraft mushes and buffets, it does not flick into a spin.
    const CLstall = 1.15 * Math.sin(2 * alpha) + 0.25 * CL0;
    const stallMix = smoothstep(aStall - 0.04, aStall + 0.09, Math.abs(alpha));
    const CL = lerp(CLlin, CLstall, stallMix);
    const CD = 0.030 + 0.07 * this.flaps + (CL * CL) / (Math.PI * 0.8 * this.AR) + 0.35 * stallMix * Math.abs(alpha);
    const CY = -0.85 * beta;

    // Wind axes -> aero body axes.
    const ca = Math.cos(alpha), sa = Math.sin(alpha);
    const L = qbar * this.S * CL, D = qbar * this.S * CD, Y = qbar * this.S * CY;
    // Lift acts perpendicular to the relative wind in the plane of symmetry,
    // drag straight back along it.
    let Fx = L * sa - D * ca;
    let Fz = -L * ca - D * sa;
    let Fy = Y;
    // Thrust: power-limited propeller, so static thrust is finite.
    const thrust = this.throttle > 0.02 ? Math.min(this.maxThrust, (this.maxPower * this.throttle) / Math.max(V, 10)) : 0;
    Fx += thrust;

    // --- moments (aero frame: L roll-right, M pitch-up, N yaw-right) ---------
    const nd = 1 / (2 * Vsafe);
    // Pitch: stable in alpha (-Cm_alpha), damped in q, commanded by the elevator.
    const Cm = 0.035 - 1.05 * alpha - 0.08 * this.flaps + 0.95 * this.elevator - 14 * qq * this.c * nd;
    // Roll: aileron authority, roll damping, dihedral effect (rolls out of a slip).
    const Cl = 0.135 * this.aileron - 0.48 * p * this.b * nd - 0.085 * beta + 0.015 * this.rudder;
    // Yaw: rudder, yaw damping, weathercock stability, adverse yaw from the ailerons,
    // and the slipstream/P-factor pull to the left at high power and low speed.
    const Cn = 0.075 * this.rudder - 0.14 * r * this.b * nd + 0.10 * beta - 0.022 * this.aileron
      - 0.012 * this.throttle * (1 - smoothstep(0, 45, V));
    let Ml = qbar * this.S * this.b * Cl;
    let Mm = qbar * this.S * this.c * Cm;
    let Mn = qbar * this.S * this.b * Cn;
    // Keep a little elevator authority while taxiing so the nose can be raised.
    Mm += 600 * this.elevator * (1 - smoothstep(0, 25, V)) * (V / 25);

    // --- back to model frame -------------------------------------------------
    const F = _v2.set(-Fy, -Fz, Fx);
    const M = _v3.set(-Mm, -Mn, Ml);
    F.add(_v4.set(0, -G * this.mass, 0).applyQuaternion(invQ));

    // --- landing gear --------------------------------------------------------
    let onGround = false, slip = 0;
    for (let i = 0; i < this.wheels.length; i++) {
      const wheel = this.wheels[i];
      const worldPt = _v5.copy(wheel.local).applyQuaternion(q).add(this.position);
      const ground = this.hf.getGround(worldPt.x, worldPt.z);
      const pen = ground - worldPt.y;
      if (pen <= 0) {
        this.state.wheelCompression[i] = lerp(this.state.wheelCompression[i], 0, 0.2);
        this.state.wheelOnGround[i] = false;
        continue;
      }
      onGround = true;
      this.state.wheelOnGround[i] = true;
      const compression = Math.min(pen, 0.35);
      this.state.wheelCompression[i] = compression;
      const rBody = wheel.local;
      const vPt = _v6.copy(vModel).add(_v7.crossVectors(this.omega, rBody));
      const normal = this.hf.getNormal(worldPt.x, worldPt.z, _v8).applyQuaternion(invQ);
      const vNormal = vPt.dot(normal);
      const fn = Math.max(0, 52000 * compression - 5200 * vNormal);
      const Fw = _v9.copy(normal).multiplyScalar(fn);
      // Tyre axes. Steering turns the nose wheel toward the commanded direction;
      // right rudder (+) must steer right, i.e. toward -X.
      const steer = wheel.steer ? -this.rudder * 0.45 : 0;
      const wheelFwd = _v10.set(-Math.sin(steer), 0, Math.cos(steer));
      const wheelRight = _v11.set(-Math.cos(steer), 0, -Math.sin(steer));
      const vLong = vPt.dot(wheelFwd), vLat = vPt.dot(wheelRight);
      const latForce = -clamp(vLat * 2200, -0.9 * fn, 0.9 * fn);
      slip = Math.max(slip, Math.abs(vLat));
      let longForce = -Math.sign(vLong) * Math.min(Math.abs(vLong) * 400, 0.025 * fn);
      if (brake && wheel.brake) longForce -= Math.sign(vLong) * Math.min(Math.abs(vLong) * 3000, 0.55 * fn);
      if (ground > 0 && !this.onRunway(worldPt.x, worldPt.z)) {
        longForce -= Math.sign(vLong) * Math.min(Math.abs(vLong) * 800, 0.12 * fn);   // grass drag
      }
      Fw.addScaledVector(wheelRight, latForce).addScaledVector(wheelFwd, longForce);
      F.add(Fw);
      M.add(_v12.crossVectors(rBody, Fw));
      if (-vNormal > 9) this.crashed = true;
    }
    const cgGround = this.hf.getGround(this.position.x, this.position.z);
    if (this.position.y < cgGround + 0.3) {
      this.crashed = true;
      this.position.y = cgGround + 0.3;
      this.velocity.multiplyScalar(0.9);
    }

    // --- integrate (semi-implicit Euler) -------------------------------------
    const aBody = F.divideScalar(this.mass);
    this.accel.copy(aBody);
    this.velocity.addScaledVector(_v13.copy(aBody).applyQuaternion(q), dt);
    this.position.addScaledVector(this.velocity, dt);
    const I = this.inertia;
    this.omega.x += (M.x / I.x) * dt;
    this.omega.y += (M.y / I.y) * dt;
    this.omega.z += (M.z / I.z) * dt;
    this.omega.multiplyScalar(Math.max(0, 1 - (onGround ? 3.0 : 0.35) * dt));
    if (onGround && this.state.wheelOnGround.every(Boolean)) this.omega.multiplyScalar(Math.max(0, 1 - 6 * dt));
    const dq = _q2.set(this.omega.x * dt * 0.5, this.omega.y * dt * 0.5, this.omega.z * dt * 0.5, 1).normalize();
    q.multiply(dq).normalize();

    if (onGround && !this.wasOnGround) this.touchdownEvent = Math.max(this.touchdownEvent, -this.velocity.y);
    this.wasOnGround = onGround;
    this.state.onGround = onGround;
    this.state.alpha = alpha;
    this.state.beta = beta;
    this.state.airspeed = V;
    this.state.stall = stallMix;
    this.state.wheelSlip = slip;
  }

  onRunway(x: number, z: number) {
    return Math.abs(x) < 560 && Math.abs(z) < 16;
  }

  private updateState(dt: number) {
    const s = this.state;
    const gAccel = this.velocity.clone().sub(this.lastVel).divideScalar(Math.max(dt, 1e-4));
    this.lastVel.copy(this.velocity);
    gAccel.y += G;
    s.gLoad = lerp(s.gLoad, gAccel.dot(this.up) / G, 0.15);
    s.groundSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    s.altitude = this.position.y;
    s.heightAGL = this.position.y - this.hf.getGround(this.position.x, this.position.z);
    s.verticalSpeed = this.velocity.y;
    s.heading = (Math.atan2(this.forward.x, -this.forward.z) + Math.PI * 2) % (Math.PI * 2);
    s.pitch = Math.asin(clamp(this.forward.y, -1, 1));
    // Positive bank = right wing low.
    s.bank = Math.asin(clamp(-this.right.y, -1, 1));
    s.throttle = this.throttle; s.flaps = this.flaps;
    // Engine RPM: idle 650, full 2600, windmilling contribution from airspeed
    const targetRpm = 650 + 1950 * this.throttle + 250 * smoothstep(0, 60, s.airspeed) * (1 - this.throttle);
    this.rpm = lerp(this.rpm, targetRpm, 1 - Math.exp(-dt * 1.8));
    s.rpm = this.rpm;
  }
}
