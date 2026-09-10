import * as THREE from 'three';

/**
 * Everything that differs between the two aircraft, in one place.
 *
 * The flight model, the visual rig, the audio and the effects all read from here, so
 * adding an aircraft is a matter of writing a config and a glTF rather than branching
 * through the codebase. The aerodynamic numbers are the ones that actually make a
 * Cessna feel like a Cessna and a Fulcrum feel like a Fulcrum: wing loading, thrust to
 * weight, roll rate, and how quickly the wing gives up.
 */
export type PropulsionKind = 'propeller' | 'turbofan';

export interface AircraftConfig {
  id: 'cessna' | 'mig29';
  name: string;
  subtitle: string;
  /** One line shown on the selection card. */
  blurb: string;
  model: string;

  // --- mass and geometry ---------------------------------------------------
  mass: number;                 // kg
  wingArea: number;             // m^2
  span: number;                 // m
  chord: number;                // mean aerodynamic chord, m
  /** Moments of inertia about the MODEL axes: x pitch, y yaw, z roll. */
  inertia: THREE.Vector3;

  // --- propulsion ----------------------------------------------------------
  propulsion: PropulsionKind;
  maxThrust: number;            // N, military power
  /** Extra thrust multiplier with the afterburner lit (1 = no afterburner). */
  afterburnerBoost: number;
  /** Propeller only: shaft power, which limits static thrust. 0 for a jet. */
  maxPower: number;
  /** Thrust falls off with altitude like this many e-foldings per scale height. */
  altitudeLapse: number;
  /** Spool time constant, seconds. A piston engine answers at once; a turbofan does not. */
  spoolTime: number;
  idleRpm: number;
  maxRpm: number;

  // --- aerodynamics --------------------------------------------------------
  cl0: number;                  // lift at zero alpha, clean
  clAlpha: number;              // per radian
  clFlaps: number;              // extra lift at full flap
  alphaStall: number;           // radians, clean
  cd0: number;                  // parasite drag
  cdFlaps: number;
  oswald: number;
  /** Transonic drag rise: Mach number where it starts, and how much it adds. */
  machDragOnset: number;
  machDragRise: number;

  // --- control ------------------------------------------------------------
  cmAlpha: number;              // pitch stiffness (negative = stable)
  cmElevator: number;
  cmQ: number;                  // pitch damping
  clAileron: number;
  clP: number;                  // roll damping
  clBeta: number;               // dihedral effect
  cnRudder: number;
  cnR: number;                  // yaw damping
  cnBeta: number;               // weathercock stability
  cnAileron: number;            // adverse yaw
  /** Torque pulling left at high power and low speed (propeller slipstream). */
  slipstreamYaw: number;
  /** Surface travel rate, deflection per second. */
  controlRate: number;
  /** How much hands-off stabilisation to apply, 0..1. */
  stability: number;
  /** Structural limit; beyond it the airframe is being over-stressed. */
  gLimit: number;

  // --- gear and ground -----------------------------------------------------
  gearSpring: number;
  gearDamping: number;
  steerAuthority: number;
  brakeForce: number;
  /** Default contacts, overwritten by the model's Contact_* locators. */
  contacts: { name: string; local: THREE.Vector3; steer: boolean; brake: boolean }[];
  retractableGear: boolean;
  /** Seconds for the gear to travel. */
  gearTravelTime: number;

  // --- presentation --------------------------------------------------------
  /** Reference speed used to scale camera distance, FOV and shake, m/s. */
  refSpeed: number;
  chaseDistance: number;
  chaseHeight: number;
  /** Field of view at rest and at reference speed. */
  fovBase: number;
  fovSpeed: number;
  /** Approach speed hint shown to the player, knots. */
  approachSpeed: number;
  rotateSpeed: number;
  /**
   * How brightly the cabin interior is lit, relative to the trainer. A fighter's
   * cockpit is a dark grey-green cave under a tinted canopy; a light aircraft's is a
   * bright greenhouse. Without this they both come out the same mid-grey.
   */
  cabinBrightness: number;
  /** Whether this aircraft carries weapons at all. The trainer never does. */
  armed: boolean;
  /** A speed brake to deploy. A light aircraft has none, and should not pretend to. */
  hasAirbrake: boolean;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export const CESSNA: AircraftConfig = {
  id: 'cessna',
  name: 'Cessna 172',
  subtitle: 'Skyhawk · monomoteur',
  blurb: 'Docile et bavard. Il monte lentement, pardonne tout, et se pose n’importe où.',
  model: '/models/cessna.glb',

  mass: 1050, wingArea: 16.2, span: 11.0, chord: 1.5,
  inertia: V(1800, 2500, 1300),

  propulsion: 'propeller',
  maxThrust: 2600, afterburnerBoost: 1, maxPower: 120000,
  altitudeLapse: 1.0, spoolTime: 0.55, idleRpm: 650, maxRpm: 2600,

  cl0: 0.32, clAlpha: 5.1, clFlaps: 0.55, alphaStall: 0.29,
  cd0: 0.030, cdFlaps: 0.07, oswald: 0.8,
  machDragOnset: 0.75, machDragRise: 0.10,

  cmAlpha: -1.25, cmElevator: 0.55, cmQ: -26,
  clAileron: 0.075, clP: -0.55, clBeta: -0.085,
  cnRudder: 0.070, cnR: -0.16, cnBeta: 0.11, cnAileron: -0.016,
  slipstreamYaw: -0.012, controlRate: 4.5, stability: 1.0, gLimit: 3.8,

  gearSpring: 52000, gearDamping: 5200, steerAuthority: 0.45, brakeForce: 3000,
  contacts: [
    { name: 'nose', local: V(0, -0.90, 1.25), steer: true, brake: false },
    { name: 'left', local: V(1.25, -0.90, -0.55), steer: false, brake: true },
    { name: 'right', local: V(-1.25, -0.90, -0.55), steer: false, brake: true },
  ],
  retractableGear: false, gearTravelTime: 1,

  refSpeed: 70, chaseDistance: 14, chaseHeight: 4.2,
  fovBase: 55, fovSpeed: 18, approachSpeed: 60, rotateSpeed: 55,
  cabinBrightness: 1.0, armed: false, hasAirbrake: false,
};

export const MIG29: AircraftConfig = {
  id: 'mig29',
  name: 'MiG-29',
  subtitle: 'Fulcrum · biréacteur',
  blurb: 'Brutal. Deux tonnes de poussée par seconde de patience, et un virage qui coupe.',
  model: '/models/mig29.glb',

  // 11 t empty plus fuel; a Fulcrum is heavy and it is felt in every reversal.
  mass: 14500, wingArea: 38.0, span: 11.4, chord: 4.2,
  inertia: V(90000, 130000, 24000),

  propulsion: 'turbofan',
  // Two RD-33: 49 kN dry each, 81 kN with the afterburner lit.
  maxThrust: 98000, afterburnerBoost: 1.66, maxPower: 0,
  altitudeLapse: 1.0, spoolTime: 2.4, idleRpm: 28, maxRpm: 100,

  // A thin, highly swept wing: less lift per degree, but it keeps flying much further
  // past the point where a light aircraft would have given up.
  cl0: 0.06, clAlpha: 3.6, clFlaps: 0.35, alphaStall: 0.42,
  cd0: 0.021, cdFlaps: 0.05, oswald: 0.72,
  machDragOnset: 0.86, machDragRise: 0.055,

  // Steady roll rate is Cl_da / -Cl_p * 2V/b: 0.048 / 0.44 at 230 m/s gives about
  // 250 deg/s, which is what a Fulcrum does. The same ratio on the Cessna would be
  // gentle — flying four times faster is most of why the jet feels so much sharper.
  // Elevator power is set so that full aft stick trims to roughly 34 degrees of alpha
  // rather than a physically meaningless number that only the protections hold back.
  cmAlpha: -0.62, cmElevator: 0.34, cmQ: -19,
  clAileron: 0.048, clP: -0.44, clBeta: -0.055,
  cnRudder: 0.085, cnR: -0.14, cnBeta: 0.16, cnAileron: -0.010,
  slipstreamYaw: 0, controlRate: 6.5, stability: 0.30, gLimit: 9.0,

  gearSpring: 620000, gearDamping: 62000, steerAuthority: 0.30, brakeForce: 42000,
  contacts: [
    { name: 'nose', local: V(0, -1.90, 4.30), steer: true, brake: false },
    { name: 'left', local: V(1.55, -1.90, -1.20), steer: false, brake: true },
    { name: 'right', local: V(-1.55, -1.90, -1.20), steer: false, brake: true },
  ],
  retractableGear: true, gearTravelTime: 4.5,

  refSpeed: 260, chaseDistance: 26, chaseHeight: 6.0,
  fovBase: 50, fovSpeed: 16, approachSpeed: 145, rotateSpeed: 140,
  cabinBrightness: 0.55, armed: true, hasAirbrake: true,
};

export const AIRCRAFT: AircraftConfig[] = [CESSNA, MIG29];
export const byId = (id: string) => AIRCRAFT.find((a) => a.id === id) ?? CESSNA;
