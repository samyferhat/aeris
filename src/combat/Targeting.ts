import * as THREE from 'three';
import { FlightModel } from '../aircraft/FlightModel';
import { DamageTarget, Ordnance } from './Ordnance';
import { STORES, Loadout } from './Armament';

/**
 * Finding something to shoot at, and telling the pilot about it.
 *
 * Three jobs, and they are deliberately kept apart from the weapons themselves:
 *  - the gun pipper, which is a prediction, not a crosshair: it is where the rounds
 *    fired now will actually be in a second, drop and all;
 *  - the lock, which walks the targets ahead of the nose and holds one;
 *  - the seeker tone, which rises as an infrared head warms to what it is looking at,
 *    and is the only instrument the pilot needs to know a shot is on.
 */

const _a = new THREE.Vector3(), _b = new THREE.Vector3();
const FWD = new THREE.Vector3(0, 0, 1);

export class Targeting {
  /** The target the next missile will follow, if any. */
  locked: DamageTarget | null = null;
  /** 0..1: how solid the lock is. A seeker takes a moment to settle. */
  lockStrength = 0;
  /** Where a burst fired now would land, and how long it takes to get there. */
  readonly pipper = new THREE.Vector3();
  pipperTime = 0;
  /** True when the predicted impact point actually meets something. */
  pipperValid = false;
  /** Rising growl of an infrared head, 0..1. Drives the audio directly. */
  tone = 0;
  /** Range to the locked target, metres. */
  range = 0;
  /** True while the shot is inside the selected weapon's envelope. */
  inRange = false;

  constructor(private ordnance: Ordnance) {}

  /** Angle off the nose, radians. */
  private off(fm: FlightModel, t: DamageTarget) {
    _a.copy(t.position).sub(fm.position);
    const d = _a.length();
    if (d < 1) return { ang: 0, d };
    _a.divideScalar(d);
    _b.copy(FWD).applyQuaternion(fm.quaternion);
    return { ang: Math.acos(THREE.MathUtils.clamp(_a.dot(_b), -1, 1)), d };
  }

  /**
   * Score a candidate. Closer to the nose is better, closer in range is better, and
   * hotter is better for an infrared head — which is why an enemy in reheat is the
   * one the seeker grabs, and a burning wreck on the ground is not.
   */
  private score(fm: FlightModel, t: DamageTarget, fov: number, maxRange: number, ir: boolean) {
    const { ang, d } = this.off(fm, t);
    if (ang > fov || d > maxRange || d < 60) return -1;
    const aim = 1 - ang / fov;
    const near = 1 - d / maxRange;
    const heat = ir ? THREE.MathUtils.clamp(t.heat, 0.1, 2.5) / 2.5 : 1;
    return aim * aim * 2.2 + near * 0.8 + heat * 1.1;
  }

  /** Walk to the next target ahead of the nose. Called by the lock key. */
  cycle(fm: FlightModel, loadout: Loadout, selected: string | null) {
    const spec = selected ? STORES[selected] : null;
    const fov = spec?.seekerFov || 0.6;
    const maxRange = spec?.range || 8000;
    const ir = spec?.guidance !== 'sarh';
    const list = this.ordnance.targets
      .filter((t) => t.alive && !t.decoy && this.score(fm, t, fov, maxRange, ir) > 0)
      .sort((p, q) => this.score(fm, q, fov, maxRange, ir) - this.score(fm, p, fov, maxRange, ir));
    if (!list.length) { this.locked = null; this.lockStrength = 0; return; }
    const i = this.locked ? list.indexOf(this.locked) : -1;
    this.locked = list[(i + 1) % list.length];
    this.lockStrength = 0;
  }

  clear() { this.locked = null; this.lockStrength = 0; this.tone = 0; }

  update(dt: number, fm: FlightModel, loadout: Loadout, selected: string | null) {
    // --- gun pipper --------------------------------------------------------
    this.pipperTime = this.ordnance.predictGunImpact(fm, this.pipper, 1.8);
    this.pipperValid = this.pipperTime < 1.75;

    // --- lock --------------------------------------------------------------
    const spec = selected ? STORES[selected] : null;
    const guided = spec?.guidance === 'ir' || spec?.guidance === 'sarh';
    if (!guided) {
      // An unguided weapon has no seeker. Keep the target for the HUD box but stop
      // pretending there is a tone.
      this.tone = Math.max(0, this.tone - dt * 3);
    }
    if (this.locked && !this.locked.alive) this.clear();

    if (this.locked && spec) {
      const { ang, d } = this.off(fm, this.locked);
      this.range = d;
      this.inRange = d < spec.range && d > 80;
      // The head holds while the target stays inside its gimbal limits, and lets go
      // smoothly rather than snapping off, which is what makes losing a lock readable.
      const within = ang < spec.seekerFov && d < spec.range * 1.1;
      const target = within ? 1 : 0;
      this.lockStrength += (target - this.lockStrength) * (1 - Math.exp(-(within ? 1.6 : 3.5) * dt));
      if (this.lockStrength < 0.04 && !within) this.clear();
    } else {
      this.range = 0;
      this.inRange = false;
      this.lockStrength = Math.max(0, this.lockStrength - dt * 2);
    }

    // --- seeker tone --------------------------------------------------------
    if (guided && this.locked) {
      const heat = THREE.MathUtils.clamp(this.locked.heat, 0, 2.5) / 2.5;
      const closeness = 1 - THREE.MathUtils.clamp(this.range / (spec!.range || 1), 0, 1);
      const want = this.lockStrength * (0.35 + 0.4 * heat + 0.25 * closeness);
      this.tone += (want - this.tone) * (1 - Math.exp(-6 * dt));
    } else if (guided) {
      // Searching: a low idle growl, so silence always means something is wrong.
      this.tone += (0.08 - this.tone) * (1 - Math.exp(-4 * dt));
    }
  }

  /**
   * Whatever the missile should follow when the button is pressed. A solid lock hands
   * over the target; a weak one hands over nothing, and the round flies straight —
   * which is the honest outcome and reads correctly.
   */
  handoff(): DamageTarget | null {
    return this.lockStrength > 0.55 ? this.locked : null;
  }
}
