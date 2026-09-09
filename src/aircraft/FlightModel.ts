import * as THREE from 'three';
import { Heightfield } from '../world/Heightfield';
import { Controls } from '../core/Input';
import { clamp, smoothstep, lerp } from '../core/Noise';

/**
 * "Realistic-arcade" 6-DOF flight model of a small single-engine high-wing aircraft.
 * Body frame: +Z forward, +Y up, +X right.  Lift/drag/moments use classic
 * non-dimensional coefficients; stall is soft, dihedral & weathervane stability make
 * the aircraft settle by itself, control rates are damped so inputs feel silky.
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
  wheels: WheelDef[] = [
    { name: 'nose', local: new THREE.Vector3(0, -0.92, 1.55), steer: true, brake: false },
    { name: 'left', local: new THREE.Vector3(-1.15, -0.92, -0.25), steer: false, brake: true },
    { name: 'right', local: new THREE.Vector3(1.15, -0.92, -0.25), steer: false, brake: true },
  ];
  readonly state: FlightState = {
    airspeed: 0, groundSpeed: 0, alpha: 0, beta: 0, gLoad: 1, altitude: 0, heightAGL: 0, heading: 0, pitch: 0, bank: 0,
    verticalSpeed: 0, rpm: 0, onGround: true, stall: 0, throttle: 0, flaps: 0, wheelCompression: [0, 0, 0], wheelOnGround: [true, true, true], wheelSlip: 0,
  };
  /** Set by the model on a touchdown: vertical speed (m/s, positive down). Consumed by game feel. */
  touchdownEvent = 0;
  private wasOnGround = true;
  private accel = new THREE.Vector3();
  private lastVel = new THREE.Vector3();
  private crashed = false;

  constructor(private hf: Heightfield) {}

  /** Attach wheel contact points read from the model (body-frame positions). */
  setWheels(defs: WheelDef[]) { this.wheels = defs; this.state.wheelCompression = defs.map(() => 0); this.state.wheelOnGround = defs.map(() => false); }

  resetOnRunway(x: number, z: number, y: number, headingRad: number) {
    this.position.set(x, y + 0.92 + 0.05, z);
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
    // Control surfaces: rate-limited for a smooth mechanical feel
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
    this.right.set(1, 0, 0).applyQuaternion(q);
    const invQ = q.clone().invert();
    // --- air data in body frame
    const vBody = this.velocity.clone().applyQuaternion(invQ);
    const V = vBody.length();
    const Vsafe = Math.max(V, 1);
    const alpha = Math.atan2(-vBody.y, Math.max(vBody.z, 0.5));   // + nose above velocity
    const beta = Math.asin(clamp(vBody.x / Vsafe, -1, 1));         // + wind from right
    const qbar = 0.5 * RHO * V * V;

    // --- lift (soft stall)
    const CL0 = 0.32 + 0.55 * this.flaps;
    const CLa = 5.1;
    const aStall = 0.29 - 0.03 * this.flaps;
    const CLlin = CL0 + CLa * alpha;
    const CLstall = 1.15 * Math.sin(2 * alpha) + 0.25 * CL0;
    const stallMix = smoothstep(aStall - 0.04, aStall + 0.09, Math.abs(alpha));
    const CL = lerp(CLlin, CLstall, stallMix);
    // --- drag
    const CD = 0.032 + 0.07 * this.flaps + 0.012 + (CL * CL) / (Math.PI * 0.8 * this.AR) + 0.35 * stallMix * Math.abs(alpha);
    const CY = -0.85 * beta;
    // wind axes → body: lift is perpendicular to the velocity in the plane of symmetry
    const vDir = V > 0.1 ? vBody.clone().normalize() : new THREE.Vector3(0, 0, 1);
    const liftDir = new THREE.Vector3(0, 1, 0).sub(vDir.clone().multiplyScalar(vDir.y)).normalize();
    const F = new THREE.Vector3();
    F.addScaledVector(liftDir, qbar * this.S * CL);
    F.addScaledVector(vDir, -qbar * this.S * CD);
    F.x += qbar * this.S * CY;
    // --- thrust (power-limited prop)
    const thrust = Math.min(this.maxThrust, (this.maxPower * this.throttle) / Math.max(V, 10)) * (this.throttle > 0.02 ? 1 : 0);
    F.z += thrust;
    // --- moments (body: x pitch, y yaw, z roll)
    const p = this.omega.z, qPitch = this.omega.x, r = this.omega.y;
    const nd = 1 / (2 * Vsafe);
    const Cm = 0.035 - 1.05 * alpha + 0.95 * this.elevator - 14 * qPitch * this.c * nd - 0.08 * this.flaps;
    const Cl = 0.135 * this.aileron - 0.48 * p * this.b * nd - 0.085 * beta + 0.015 * this.rudder;
    const Cn = 0.075 * this.rudder - 0.14 * r * this.b * nd + 0.10 * beta - 0.022 * this.aileron
      - 0.012 * this.throttle * (1 - smoothstep(0, 45, V));  // P-factor / slipstream: yaws left at high power low speed
    const M = new THREE.Vector3(qbar * this.S * this.c * Cm, qbar * this.S * this.b * Cn, qbar * this.S * this.b * Cl);
    // Low-speed control authority floor so taxiing/ground handling still responds
    const low = 1 - smoothstep(0, 25, V);
    M.x += 600 * this.elevator * low * (V / 25);

    // --- ground contact
    let onGround = false, slip = 0;
    const gravityBody = new THREE.Vector3(0, -G * this.mass, 0).applyQuaternion(invQ);
    F.add(gravityBody);
    const nWheels = this.wheels.length;
    for (let i = 0; i < nWheels; i++) {
      const w = this.wheels[i];
      const worldPt = w.local.clone().applyQuaternion(q).add(this.position);
      const ground = this.hf.getGround(worldPt.x, worldPt.z);
      const pen = ground - worldPt.y;
      if (pen <= 0) { this.state.wheelCompression[i] = lerp(this.state.wheelCompression[i], 0, 0.2); this.state.wheelOnGround[i] = false; continue; }
      onGround = true; this.state.wheelOnGround[i] = true;
      const compression = Math.min(pen, 0.35);
      this.state.wheelCompression[i] = compression;
      // point velocity
      const rBody = w.local.clone();
      const vPtBody = vBody.clone().add(new THREE.Vector3().crossVectors(this.omega, rBody));
      const normal = this.hf.getNormal(worldPt.x, worldPt.z).applyQuaternion(invQ);
      const vNormal = vPtBody.dot(normal);
      const k = 52000, cDamp = 5200;
      let fn = k * compression - cDamp * vNormal;
      fn = Math.max(0, fn);
      const Fw = normal.clone().multiplyScalar(fn);
      // tire directions (steering on nose wheel)
      const steer = w.steer ? -this.rudder * 0.45 : 0;
      const wheelFwd = new THREE.Vector3(Math.sin(steer), 0, Math.cos(steer));
      const wheelSide = new THREE.Vector3(Math.cos(steer), 0, -Math.sin(steer));
      const vLong = vPtBody.dot(wheelFwd), vLat = vPtBody.dot(wheelSide);
      // lateral grip (saturating)
      const latForce = -clamp(vLat * 2200, -0.9 * fn, 0.9 * fn);
      slip = Math.max(slip, Math.abs(vLat));
      // rolling resistance + brakes
      let longForce = -Math.sign(vLong) * Math.min(Math.abs(vLong) * 400, 0.025 * fn);
      if (brake && w.brake) longForce -= Math.sign(vLong) * Math.min(Math.abs(vLong) * 3000, 0.55 * fn);
      const offRunway = ground > 0 && !this.onRunway(worldPt.x, worldPt.z);
      if (offRunway) longForce -= Math.sign(vLong) * Math.min(Math.abs(vLong) * 800, 0.12 * fn); // grass drag
      Fw.addScaledVector(wheelSide, latForce).addScaledVector(wheelFwd, longForce);
      F.add(Fw);
      M.add(new THREE.Vector3().crossVectors(rBody, Fw));
      // crash check: hard hit
      if (-vNormal > 9) this.crashed = true;
    }
    // Fuselage/wing ground scrape (crash) – very simple: CG below ground
    const cgGround = this.hf.getGround(this.position.x, this.position.z);
    if (this.position.y < cgGround + 0.3) {
      this.crashed = true;
      this.position.y = cgGround + 0.3;
      this.velocity.multiplyScalar(0.9);
    }

    // --- integrate (semi-implicit Euler)
    const aBody = F.divideScalar(this.mass);
    this.accel.copy(aBody);
    const aWorld = aBody.clone().applyQuaternion(q);
    this.velocity.addScaledVector(aWorld, dt);
    // arcade air damping for a calmer feel at rest
    this.velocity.multiplyScalar(1 - 0.002 * dt);
    this.position.addScaledVector(this.velocity, dt);
    const I = this.inertia;
    const alphaAng = new THREE.Vector3(M.x / I.x, M.y / I.y, M.z / I.z);
    // gyroscopic-ish cross term (small) and rate damping
    this.omega.addScaledVector(alphaAng, dt);
    const damp = onGround ? 3.0 : 0.35;
    this.omega.multiplyScalar(Math.max(0, 1 - damp * dt));
    // Ground: keep the roll/pitch axes stiff when 3 wheels are down
    if (onGround && this.state.wheelOnGround.every(Boolean)) this.omega.multiplyScalar(Math.max(0, 1 - 6 * dt));
    const dq = new THREE.Quaternion(this.omega.x * dt * 0.5, this.omega.y * dt * 0.5, this.omega.z * dt * 0.5, 1).normalize();
    q.multiply(dq).normalize();

    if (onGround && !this.wasOnGround) this.touchdownEvent = Math.max(this.touchdownEvent, -this.velocity.y);
    this.wasOnGround = onGround;
    this.state.onGround = onGround;
    this.state.alpha = alpha; this.state.beta = beta; this.state.airspeed = V; this.state.stall = stallMix;
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
    const rightFlat = new THREE.Vector3(this.right.x, 0, this.right.z);
    s.bank = Math.atan2(-this.right.y, rightFlat.length()) * -1;
    s.bank = Math.asin(clamp(this.right.y, -1, 1)) * -1;
    s.throttle = this.throttle; s.flaps = this.flaps;
    // Engine RPM: idle 650, full 2600, windmilling contribution from airspeed
    const targetRpm = 650 + 1950 * this.throttle + 250 * smoothstep(0, 60, s.airspeed) * (1 - this.throttle);
    this.rpm = lerp(this.rpm, targetRpm, 1 - Math.exp(-dt * 1.8));
    s.rpm = this.rpm;
  }
}
