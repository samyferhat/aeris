import * as THREE from 'three';
import { Heightfield } from '../world/Heightfield';
import { Controls } from '../core/Input';
import { clamp, smoothstep, lerp } from '../core/Noise';
import { AircraftConfig } from './AircraftConfig';

/**
 * "Realistic-arcade" 6-DOF flight model, driven entirely by an AircraftConfig.
 *
 * Two frames are in play and mixing them up is the classic source of inverted controls:
 *
 *   MODEL frame (what the glTF and Three.js use): +Z nose, +Y up, +X LEFT wing.
 *   AERO frame  (what the coefficients are written in, as in every textbook):
 *               x forward, y right, z down; p roll-right, q pitch-up, r yaw-right.
 *
 *   x_aero = +Z_model ; y_aero = -X_model ; z_aero = -Y_model
 *
 * Everything aerodynamic is computed in the aero frame and rotated back once at the end.
 * Stall is soft, dihedral and weathercock stability let the aircraft settle by itself,
 * and control rates are damped so the inputs feel silky rather than twitchy.
 */
export interface WheelDef { name: string; local: THREE.Vector3; steer: boolean; brake: boolean }

export interface FlightState {
  airspeed: number;        // true airspeed, m/s
  indicatedSpeed: number;  // equivalent airspeed — what an ASI would read
  mach: number;
  groundSpeed: number;
  alpha: number; beta: number; gLoad: number;
  altitude: number; heightAGL: number; heading: number; pitch: number; bank: number; verticalSpeed: number;
  rpm: number; onGround: boolean; stall: number; throttle: number; flaps: number;
  /** 0..1, how far into the afterburner detent the throttle is. */
  afterburner: number;
  /** 1 = down and locked, 0 = up. */
  gear: number;
  /** Set while the airframe is being pulled past its limit. */
  overG: number;
  wheelCompression: number[]; wheelOnGround: boolean[]; wheelSlip: number;
}

const G = 9.81;
const RHO0 = 1.225;

/** International Standard Atmosphere, troposphere only — plenty for this world. */
function isa(altitude: number) {
  const h = Math.max(0, Math.min(altitude, 20000));
  const T = 288.15 - 0.0065 * Math.min(h, 11000);
  const rho = h <= 11000
    ? RHO0 * Math.pow(T / 288.15, 4.2561)
    : 0.3639 * Math.exp(-(h - 11000) / 6341.6);
  const a = 20.0468 * Math.sqrt(T);   // speed of sound, m/s
  return { rho, a };
}

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
  readonly right = new THREE.Vector3(-1, 0, 0);

  // Runtime control state
  flaps = 0; flapsTarget = 0;
  elevator = 0; aileron = 0; rudder = 0;
  throttle = 0;
  /** Spooled engine setting, lags the throttle by the configured spool time. */
  power = 0;
  rpm = 0;
  /** Commanded gear position: 1 down, 0 up. Moves at the configured rate. */
  gearTarget = 1;
  gear = 1;
  /** Airbrake: commanded 0/1, and the panel's actual travel. */
  airbrakeTarget = 0;
  airbrake = 0;
  /**
   * Pitch trim, -1..1, added to the stick. What it is for is holding an attitude with
   * the stick centred, which is also the only way the hands-off stabiliser can be
   * persuaded to hold something other than level.
   */
  trim = 0;
  /** Mass of the external stores still on the pylons, kg. Owned by the loadout. */
  storeMass = 0;
  /** Parasite drag coefficient the same stores add. */
  storeDrag = 0;
  wheels: WheelDef[] = [];

  readonly state: FlightState = {
    airspeed: 0, indicatedSpeed: 0, mach: 0, groundSpeed: 0, alpha: 0, beta: 0, gLoad: 1,
    altitude: 0, heightAGL: 0, heading: 0, pitch: 0, bank: 0, verticalSpeed: 0,
    rpm: 0, onGround: true, stall: 0, throttle: 0, flaps: 0, afterburner: 0, gear: 1, overG: 0,
    wheelCompression: [0, 0, 0], wheelOnGround: [true, true, true], wheelSlip: 0,
  };

  /** Vertical speed at the moment of touchdown, m/s. Consumed by the game-feel layer. */
  touchdownEvent = 0;
  /**
   * Anything solid that is not the ground: a building, a crane, the bridge deck.
   * Takes a height as well as a footprint, because going under the bridge has to work.
   */
  solidAt: ((x: number, y: number, z: number) => boolean) | null = null;
  private wasOnGround = true;
  private accel = new THREE.Vector3();
  get bodyAccel() { return this.accel; }
  private lastVel = new THREE.Vector3();
  private crashed = false;

  constructor(private hf: Heightfield, public config: AircraftConfig) {
    this.setConfig(config);
  }

  /** Swaps the aircraft. Keeps the heightfield; resets the flight state. */
  setConfig(config: AircraftConfig) {
    this.config = config;
    this.wheels = config.contacts.map((c) => ({ ...c, local: c.local.clone() }));
    this.state.wheelCompression = this.wheels.map(() => 0);
    this.state.wheelOnGround = this.wheels.map(() => false);
    this.gear = this.gearTarget = 1;
  }

  setWheels(defs: WheelDef[]) {
    this.wheels = defs;
    this.state.wheelCompression = defs.map(() => 0);
    this.state.wheelOnGround = defs.map(() => false);
  }

  syncBasis() {
    this.forward.set(0, 0, 1).applyQuaternion(this.quaternion);
    this.up.set(0, 1, 0).applyQuaternion(this.quaternion);
    this.right.set(-1, 0, 0).applyQuaternion(this.quaternion);
  }

  resetOnRunway(x: number, z: number, y: number, headingRad: number) {
    // Set the wheels slightly compressed rather than hovering: starting in the air means
    // the first frames report airborne, which trips anything watching for a touchdown.
    const groundClearance = -this.wheels.reduce((m, w) => Math.min(m, w.local.y), 0);
    this.position.set(x, y + groundClearance - 0.02, z);
    this.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), headingRad);
    this.velocity.set(0, 0, 0);
    this.omega.set(0, 0, 0);
    this.throttle = 0; this.power = 0; this.flaps = 0; this.flapsTarget = 0; this.rpm = 0;
    this.gear = this.gearTarget = 1;
    this.airbrake = this.airbrakeTarget = 0;
    this.trim = 0;
    this.crashed = false;
    this.lastVel.set(0, 0, 0);
    this.syncBasis();
    this.updateState(1 / 60);
    // The aircraft is placed a few centimetres above the surface and settles onto it in
    // the first frames; that is not an arrival, so do not let it fire one.
    this.wasOnGround = true;
    this.touchdownEvent = 0;
  }

  get isCrashed() { return this.crashed; }
  /** Shot down, rather than flown into the ground. */
  destroy() { this.crashed = true; }

  step(dt: number, ctrl: Controls) {
    const cfg = this.config;
    const sub = 4, h = dt / sub;
    this.throttle = ctrl.throttle;
    this.flapsTarget = ctrl.flaps;

    // Engine spool. A piston engine answers the throttle almost at once; a turbofan
    // takes seconds, which is most of why a jet has to be flown ahead of itself.
    this.power += (this.throttle - this.power) * (1 - Math.exp(-dt / cfg.spoolTime));

    // Gear travel.
    if (cfg.retractableGear) {
      const rate = dt / cfg.gearTravelTime;
      this.gear += clamp(this.gearTarget - this.gear, -rate, rate);
    } else {
      this.gear = 1;
    }

    const rate = cfg.controlRate * dt;
    // Trim shifts the stick's neutral point rather than adding to its travel, so full
    // aft stick is still full aft stick however the aircraft is trimmed.
    const pitchCmd = clamp(ctrl.pitch + this.trim, -1, 1);
    this.elevator += clamp(pitchCmd - this.elevator, -rate, rate);
    this.aileron += clamp(ctrl.roll - this.aileron, -rate, rate);
    this.rudder += clamp(ctrl.yaw - this.rudder, -rate, rate);
    this.flaps += clamp(this.flapsTarget - this.flaps, -0.25 * dt, 0.25 * dt);
    // A speed brake takes about a second and a half to run out and rather less to
    // stow, which is why it is worth having a travel at all rather than a boolean.
    this.airbrakeTarget = ctrl.airbrake && cfg.hasAirbrake ? 1 : 0;
    this.airbrake += clamp(this.airbrakeTarget - this.airbrake, -1.6 * dt, 0.7 * dt);

    for (let i = 0; i < sub; i++) this.integrate(h, ctrl.brake);
    this.updateState(dt);
  }

  private integrate(dt: number, brake: boolean) {
    const cfg = this.config;
    // External stores are heavy and draggy, and both change as they leave: a MiG that
    // has just emptied its pylons should feel noticeably lighter and faster, which is
    // half the reward for spending the ordnance.
    const mass = cfg.mass + this.storeMass;
    const q = this.quaternion;
    this.syncBasis();
    const invQ = _q1.copy(q).invert();

    // --- atmosphere and air data, in the aero frame --------------------------
    const { rho, a: soundSpeed } = isa(this.position.y);
    const vModel = _v1.copy(this.velocity).applyQuaternion(invQ);
    const u = vModel.z, v = -vModel.x, w = -vModel.y;   // forward, right, down
    const V = Math.hypot(u, v, w);
    const Vsafe = Math.max(V, 1);
    const alpha = Math.atan2(w, Math.max(u, 0.5));
    const beta = Math.asin(clamp(v / Vsafe, -1, 1));
    const qbar = 0.5 * rho * V * V;
    const mach = V / soundSpeed;
    const p = this.omega.z, qq = -this.omega.x, r = -this.omega.y;

    // --- lift ---------------------------------------------------------------
    const CL0 = cfg.cl0 + cfg.clFlaps * this.flaps;
    const aStall = cfg.alphaStall - 0.03 * this.flaps;
    const CLlin = CL0 + cfg.clAlpha * alpha;
    // Past the stall the curve rolls over instead of falling off a cliff: the aircraft
    // mushes and buffets rather than departing.
    const CLstall = 0.75 * cfg.clAlpha * Math.sin(2 * alpha) * 0.45 + 0.25 * CL0;
    const stallMix = smoothstep(aStall - 0.04, aStall + 0.09, Math.abs(alpha));
    const CL = lerp(CLlin, CLstall, stallMix);

    // --- drag ---------------------------------------------------------------
    const AR = (cfg.span * cfg.span) / cfg.wingArea;
    // Transonic rise: the drag divergence that makes level supersonic flight a decision
    // rather than an accident.
    const machDrag = cfg.machDragRise * smoothstep(cfg.machDragOnset, cfg.machDragOnset + 0.14, mach);
    const gearDrag = 0.022 * this.gear * (cfg.retractableGear ? 1 : 0);
    // The board is a flat plate in the airstream: a large, honest lump of parasite drag
    // and nothing else. On the fighter it is most of how you slow down at all.
    const brakeDrag = 0.085 * this.airbrake;
    const CD = cfg.cd0 + this.storeDrag + cfg.cdFlaps * this.flaps + gearDrag + machDrag + brakeDrag
      + (CL * CL) / (Math.PI * cfg.oswald * AR)
      + 0.35 * stallMix * Math.abs(alpha);
    const CY = -0.85 * beta;

    const ca = Math.cos(alpha), sa = Math.sin(alpha);
    const L = qbar * cfg.wingArea * CL, D = qbar * cfg.wingArea * CD, Y = qbar * cfg.wingArea * CY;
    let Fx = L * sa - D * ca;
    let Fz = -L * ca - D * sa;
    let Fy = Y;

    // --- thrust -------------------------------------------------------------
    // The afterburner lives in the top of the throttle travel, as a detent does.
    const ab = cfg.afterburnerBoost > 1 ? smoothstep(0.88, 0.97, this.power) : 0;
    const densityRatio = Math.pow(rho / RHO0, cfg.altitudeLapse);
    let thrust: number;
    if (cfg.propulsion === 'propeller') {
      // Power-limited: static thrust is finite because a propeller can only do so much
      // work on still air.
      thrust = this.power > 0.02 ? Math.min(cfg.maxThrust, (cfg.maxPower * this.power) / Math.max(V, 10)) : 0;
      thrust *= densityRatio;
    } else {
      const mil = cfg.maxThrust * (0.06 + 0.94 * this.power);
      thrust = mil * (1 + (cfg.afterburnerBoost - 1) * ab) * densityRatio;
      // Ram recovery: a turbofan gains a little as it goes faster.
      thrust *= 1 + 0.28 * Math.min(1.4, mach) * Math.min(1.4, mach);
    }
    Fx += thrust;

    // --- moments (aero frame: L roll-right, M pitch-up, N yaw-right) --------
    const nd = 1 / (2 * Vsafe);
    // Progressive alpha protection. The stick commands an angle of attack fairly
    // directly, so without this a full pull simply trims the wing past the stall and
    // the aeroplane mushes along nose-high forever. Authority is never zero, so a
    // deliberate stall is still available to anyone who insists.
    const alphaProtection = 1 - 0.88 * smoothstep(aStall - 0.13, aStall + 0.01, alpha);
    // A fighter is also limited by what the airframe will take, not just the air.
    const gProtection = 1 - 0.75 * smoothstep(cfg.gLimit * 0.88, cfg.gLimit * 1.1, this.state.gLoad);
    const elevatorEff = this.elevator > 0 ? this.elevator * alphaProtection * gProtection : this.elevator;

    const Cm = 0.035 + cfg.cmAlpha * alpha - 0.08 * this.flaps
      + cfg.cmElevator * elevatorEff + cfg.cmQ * qq * cfg.chord * nd
      // A dorsal board unloads the fin and pitches the nose up a little as it opens.
      - 0.030 * this.airbrake;
    const Cl = cfg.clAileron * this.aileron + cfg.clP * p * cfg.span * nd
      + cfg.clBeta * beta + 0.015 * this.rudder;
    const Cn = cfg.cnRudder * this.rudder + cfg.cnR * r * cfg.span * nd
      + cfg.cnBeta * beta + cfg.cnAileron * this.aileron
      + cfg.slipstreamYaw * this.power * (1 - smoothstep(0, 45, V));

    let Ml = qbar * cfg.wingArea * cfg.span * Cl;
    let Mm = qbar * cfg.wingArea * cfg.chord * Cm;
    let Mn = qbar * cfg.wingArea * cfg.span * Cn;
    // A little pitch authority at taxi speed so the nose can be raised.
    Mm += 0.4 * mass * elevatorEff * (1 - smoothstep(0, 25, V)) * (V / 25);

    // Hands-off stabilisation. A real aeroplane is statically stable but takes tens of
    // seconds to settle; on a keyboard that reads as one that will not hold what you
    // set. These terms act only while the matching axis is near neutral, so they never
    // fight an input, and the fighter gets much less of it than the trainer.
    if (V > 12 && cfg.stability > 0) {
      const airborne = this.state.onGround ? 0.25 : 1;
      const bankAngle = Math.asin(clamp(-this.right.y, -1, 1));
      const pitchAngle = Math.asin(clamp(this.forward.y, -1, 1));
      const relaxRoll = Math.max(0, 1 - Math.abs(this.aileron) * 6) * airborne * cfg.stability;
      const relaxPitch = Math.max(0, 1 - Math.abs(this.elevator) * 6) * airborne * cfg.stability;
      const authority = Math.min(1, qbar / 600) * mass;
      Ml += (-bankAngle * 1.43 - p * 2.48) * relaxRoll * authority;
      Mm += (-pitchAngle * 1.33 - qq * 3.24) * relaxPitch * authority;
      Mn += (-r * 1.43) * authority * airborne * cfg.stability;
    }

    // --- back to model frame ------------------------------------------------
    const F = _v2.set(-Fy, -Fz, Fx);
    const M = _v3.set(-Mm, -Mn, Ml);
    F.add(_v4.set(0, -G * mass, 0).applyQuaternion(invQ));

    // --- landing gear -------------------------------------------------------
    let onGround = false, slip = 0;
    const gearOut = this.gear > 0.85 ? 1 : 0;
    for (let i = 0; i < this.wheels.length; i++) {
      const wheel = this.wheels[i];
      const worldPt = _v5.copy(wheel.local).applyQuaternion(q).add(this.position);
      const ground = this.hf.getGround(worldPt.x, worldPt.z);
      const pen = ground - worldPt.y;
      if (pen <= 0 || !gearOut) {
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
      const fn = Math.max(0, cfg.gearSpring * compression - cfg.gearDamping * vNormal);
      const Fw = _v9.copy(normal).multiplyScalar(fn);
      // Right rudder must steer right, i.e. toward -X.
      const steer = wheel.steer ? -this.rudder * cfg.steerAuthority : 0;
      const wheelFwd = _v10.set(-Math.sin(steer), 0, Math.cos(steer));
      const wheelRight = _v11.set(-Math.cos(steer), 0, -Math.sin(steer));
      const vLong = vPt.dot(wheelFwd), vLat = vPt.dot(wheelRight);
      const latForce = -clamp(vLat * cfg.gearSpring * 0.042, -0.9 * fn, 0.9 * fn);
      slip = Math.max(slip, Math.abs(vLat));
      let longForce = -Math.sign(vLong) * Math.min(Math.abs(vLong) * mass * 0.38, 0.025 * fn);
      if (brake && wheel.brake) longForce -= Math.sign(vLong) * Math.min(Math.abs(vLong) * cfg.brakeForce, 0.55 * fn);
      if (ground > 0 && !this.onRunway(worldPt.x, worldPt.z)) {
        longForce -= Math.sign(vLong) * Math.min(Math.abs(vLong) * mass * 0.76, 0.12 * fn);   // grass drag
      }
      Fw.addScaledVector(wheelRight, latForce).addScaledVector(wheelFwd, longForce);
      F.add(Fw);
      M.add(_v12.crossVectors(rBody, Fw));
      if (-vNormal > 11) this.crashed = true;
    }

    // Anything but the wheels touching is a crash. Park it and bleed the energy away
    // rather than bouncing it back out.
    const clearance = -this.wheels.reduce((m, wl) => Math.min(m, wl.local.y), 0);
    if (this.solidAt && this.solidAt(this.position.x, this.position.y, this.position.z)) {
      this.crashed = true;
      this.velocity.multiplyScalar(Math.max(0, 1 - 7 * dt));
      this.omega.multiplyScalar(Math.max(0, 1 - 9 * dt));
    }
    const cgGround = this.hf.getGround(this.position.x, this.position.z);
    if (this.position.y < cgGround + clearance * 0.6) {
      this.crashed = true;
      this.position.y = cgGround + clearance * 0.6;
      this.velocity.multiplyScalar(Math.max(0, 1 - 5 * dt));
      this.omega.multiplyScalar(Math.max(0, 1 - 8 * dt));
    }

    // --- integrate (semi-implicit Euler) ------------------------------------
    const aBody = F.divideScalar(mass);
    this.accel.copy(aBody);
    this.velocity.addScaledVector(_v13.copy(aBody).applyQuaternion(q), dt);
    this.position.addScaledVector(this.velocity, dt);
    const I = cfg.inertia;
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
    this.state.mach = mach;
    this.state.indicatedSpeed = V * Math.sqrt(rho / RHO0);
    this.state.stall = stallMix;
    this.state.wheelSlip = slip;
    this.state.afterburner = ab;
  }

  onRunway(x: number, z: number) {
    return Math.abs(x) < 560 && Math.abs(z) < 16;
  }

  private updateState(dt: number) {
    const s = this.state, cfg = this.config;
    const gAccel = this.velocity.clone().sub(this.lastVel).divideScalar(Math.max(dt, 1e-4));
    this.lastVel.copy(this.velocity);
    gAccel.y += G;
    s.gLoad = lerp(s.gLoad, gAccel.dot(this.up) / G, 0.15);
    s.overG = smoothstep(cfg.gLimit * 0.92, cfg.gLimit * 1.15, Math.abs(s.gLoad));
    s.groundSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    s.altitude = this.position.y;
    s.heightAGL = this.position.y - this.hf.getGround(this.position.x, this.position.z);
    s.verticalSpeed = this.velocity.y;
    s.heading = (Math.atan2(this.forward.x, -this.forward.z) + Math.PI * 2) % (Math.PI * 2);
    s.pitch = Math.asin(clamp(this.forward.y, -1, 1));
    s.bank = Math.asin(clamp(-this.right.y, -1, 1));
    s.throttle = this.throttle;
    s.flaps = this.flaps;
    s.gear = this.gear;
    const windmill = cfg.propulsion === 'propeller' ? 250 * smoothstep(0, 60, s.airspeed) * (1 - this.power) : 0;
    const target = cfg.idleRpm + (cfg.maxRpm - cfg.idleRpm) * this.power + windmill;
    this.rpm = lerp(this.rpm, target, 1 - Math.exp(-dt / Math.max(0.2, cfg.spoolTime * 0.6)));
    s.rpm = this.rpm;
  }
}
