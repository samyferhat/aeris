/**
 * What the MiG-29 (izdeliye 9.13) can actually carry, and what it does when fired.
 *
 * The catalogue is the single source of truth: the loadout screen reads it to know
 * what fits where, the store rack reads it to know which mesh to clone, the flight
 * model reads it for mass and drag, and the ordnance simulation reads it for the
 * ballistics. Nothing about a weapon is written down twice.
 *
 * Figures are the real ones. They matter more than they look: a 253 kg R-27 hanging
 * outboard of a 105 kg R-73 is the difference between a jet that rolls and one that
 * wallows, and the player feels that long before they read a number.
 */

export type StoreKind = 'aam' | 'rocketpod' | 'heavyrocket' | 'bomb' | 'dispenser';
export type Guidance = 'ir' | 'sarh' | 'none';

export interface StoreSpec {
  id: string;
  /** Russian designation, and the NATO reporting name under it on the card. */
  name: string;
  nato: string;
  role: string;
  kind: StoreKind;
  /** Object name inside stores.glb. */
  model: string;
  /** Loaded mass of one store, kg. */
  mass: number;
  length: number;
  /** Body diameter, m: the rack uses half of it to sit the store under its pylon. */
  diameter: number;
  /** Extra parasite drag coefficient, referenced to the wing area. */
  drag: number;
  guidance: Guidance;
  /** Shots held: one for a missile or a bomb, twenty for a B-8M1. */
  rounds: number;
  /** Which stations will take it. 1 is outboard, 3 inboard. */
  stations: number[];
  /** Nudge along the aircraft's own +Z (nose) so a long store clears the wing. */
  mountOffset?: number;

  // --- flight, once it has left the rail ---------------------------------------
  /** Seconds of free fall between release and motor light-up. Zero for a bomb. */
  dropTime: number;
  /** Motor thrust, N, and how long it burns. */
  thrust: number;
  burnTime: number;
  /** Drag area, m^2 · Cd, used for the store's own ballistics after release. */
  cda: number;
  /** Peak lateral acceleration the airframe can pull while guiding, in g. */
  maxG: number;
  /** How far the seeker or the salvo is useful, m. */
  range: number;
  /** Seeker half-angle, radians. Off-boresight capability is the R-73's whole point. */
  seekerFov: number;
  /** Warhead: blast radius in metres, and how much damage a direct hit does. */
  blast: number;
  damage: number;
  /** Self-destruct time so nothing flies forever. */
  life: number;
}

const S = (s: StoreSpec) => s;

export const STORES: Record<string, StoreSpec> = {
  // ---- air to air ------------------------------------------------------------
  R73: S({
    id: 'R73', name: 'R-73', nato: 'AA-11 Archer', role: 'Air-air courte portée · IR',
    kind: 'aam', model: 'R73', mass: 105, length: 2.90, diameter: 0.170, drag: 0.0022,
    guidance: 'ir', rounds: 1, stations: [1, 2, 3],
    dropTime: 0.20, thrust: 22000, burnTime: 5.5, cda: 0.048, maxG: 40,
    range: 12000, seekerFov: 0.79, blast: 22, damage: 140, life: 26,
  }),
  R27: S({
    id: 'R27', name: 'R-27R', nato: 'AA-10 Alamo', role: 'Air-air moyenne portée · radar',
    kind: 'aam', model: 'R27', mass: 253, length: 4.08, diameter: 0.230, drag: 0.0041,
    guidance: 'sarh', rounds: 1, stations: [2, 3], mountOffset: 0.35,
    dropTime: 0.28, thrust: 36000, burnTime: 6.5, cda: 0.082, maxG: 26,
    range: 26000, seekerFov: 0.40, blast: 30, damage: 200, life: 42,
  }),
  R60: S({
    id: 'R60', name: 'R-60M', nato: 'AA-8 Aphid', role: 'Air-air courte portée · IR',
    kind: 'aam', model: 'R60', mass: 44, length: 2.09, diameter: 0.120, drag: 0.0013,
    guidance: 'ir', rounds: 1, stations: [1, 2, 3],
    dropTime: 0.16, thrust: 12000, burnTime: 3.2, cda: 0.026, maxG: 32,
    range: 6000, seekerFov: 0.44, blast: 14, damage: 90, life: 18,
  }),

  // ---- air to ground, all of it unguided, which is historically what 9.13 had ---
  B8M1: S({
    id: 'B8M1', name: 'B-8M1', nato: '20 × S-8', role: 'Roquettes 80 mm · salve',
    kind: 'rocketpod', model: 'B8M1', mass: 330, length: 2.76, diameter: 0.520, drag: 0.0090,
    guidance: 'none', rounds: 20, stations: [2, 3],
    dropTime: 0, thrust: 5600, burnTime: 0.9, cda: 0.012, maxG: 0,
    range: 4000, seekerFov: 0, blast: 12, damage: 55, life: 12,
  }),
  UB32: S({
    id: 'UB32', name: 'UB-32', nato: '32 × S-5', role: 'Roquettes 57 mm · salve dense',
    kind: 'rocketpod', model: 'UB32', mass: 287, length: 2.08, diameter: 0.460, drag: 0.0082,
    guidance: 'none', rounds: 32, stations: [2, 3],
    dropTime: 0, thrust: 3200, burnTime: 0.6, cda: 0.008, maxG: 0,
    range: 3000, seekerFov: 0, blast: 8, damage: 32, life: 10,
  }),
  S24: S({
    id: 'S24', name: 'S-24B', nato: '—', role: 'Roquette lourde 240 mm · à l’unité',
    kind: 'heavyrocket', model: 'S24', mass: 235, length: 2.33, diameter: 0.240, drag: 0.0030,
    guidance: 'none', rounds: 1, stations: [2, 3],
    dropTime: 0, thrust: 41000, burnTime: 1.1, cda: 0.030, maxG: 0,
    range: 4500, seekerFov: 0, blast: 34, damage: 260, life: 14,
  }),
  FAB250: S({
    id: 'FAB250', name: 'FAB-250', nato: '—', role: 'Bombe lisse 250 kg',
    kind: 'bomb', model: 'FAB250', mass: 250, length: 1.924, diameter: 0.285, drag: 0.0034,
    guidance: 'none', rounds: 1, stations: [2, 3],
    dropTime: 0, thrust: 0, burnTime: 0, cda: 0.060, maxG: 0,
    range: 0, seekerFov: 0, blast: 30, damage: 300, life: 60,
  }),
  FAB500: S({
    id: 'FAB500', name: 'FAB-500', nato: '—', role: 'Bombe lisse 500 kg',
    kind: 'bomb', model: 'FAB500', mass: 500, length: 2.425, diameter: 0.400, drag: 0.0052,
    guidance: 'none', rounds: 1, stations: [3],
    dropTime: 0, thrust: 0, burnTime: 0, cda: 0.105, maxG: 0,
    range: 0, seekerFov: 0, blast: 44, damage: 520, life: 60,
  }),
  KMGU: S({
    id: 'KMGU', name: 'KMGU-2', nato: '—', role: 'Distributeur de sous-munitions',
    kind: 'dispenser', model: 'KMGU', mass: 520, length: 3.70, diameter: 0.500, drag: 0.0088,
    guidance: 'none', rounds: 8, stations: [3], mountOffset: 0.20,
    dropTime: 0, thrust: 0, burnTime: 0, cda: 0.030, maxG: 0,
    range: 0, seekerFov: 0, blast: 16, damage: 70, life: 30,
  }),
};

/** The rocket that leaves a pod, as opposed to the pod itself. */
export const S8_MODEL = 'S8';

/**
 * GSh-30-1. One barrel, thirty millimetres, a hundred and fifty rounds and fifteen
 * hundred a minute, which is six seconds of trigger for the whole sortie. The
 * ammunition count is the design: it forces short, aimed bursts.
 */
export const GUN = {
  name: 'GSh-30-1', calibre: 0.030, rounds: 150, rpm: 1500,
  muzzleVelocity: 860,
  /** Rounds are 390 g; the recoil impulse is what shakes the airframe. */
  roundMass: 0.390,
  /** Cone of dispersion, radians (1 sigma). Real guns are not lasers. */
  dispersion: 0.0022,
  /** One round in five is a tracer. */
  tracerEvery: 5,
  damage: 26, blast: 2.2,
  /** Bullets are only simulated this far; past it they are irrelevant anyway. */
  range: 2600,
} as const;

// ---------------------------------------------------------------- pylons -----

export type PylonId = 'L1' | 'L2' | 'L3' | 'R1' | 'R2' | 'R3';
/** Outboard to inboard on the left, then the right. */
export const PYLONS: PylonId[] = ['L1', 'L2', 'L3', 'R1', 'R2', 'R3'];
export const stationOf = (p: PylonId) => Number(p[1]);
export const sideOf = (p: PylonId) => (p[0] === 'L' ? -1 : 1);

export interface PylonState {
  id: PylonId;
  /** Store id, or null for a clean station. */
  store: string | null;
  /** Shots left on this station. */
  remaining: number;
}

export const fits = (storeId: string, pylon: PylonId) =>
  STORES[storeId]?.stations.includes(stationOf(pylon)) ?? false;

export type PresetId = 'aa' | 'ag' | 'mixed';

export const PRESETS: Record<PresetId, { label: string; hint: string; stores: Record<PylonId, string | null> }> = {
  aa: {
    label: 'Air-Air', hint: 'Deux Archer en bout d’aile, quatre Alamo. Rien pour le sol.',
    stores: { L1: 'R73', L2: 'R27', L3: 'R27', R1: 'R73', R2: 'R27', R3: 'R27' },
  },
  ag: {
    label: 'Air-Sol', hint: 'Une paire d’Archer pour la route, le reste pour la cible.',
    stores: { L1: 'R73', L2: 'B8M1', L3: 'FAB500', R1: 'R73', R2: 'B8M1', R3: 'FAB500' },
  },
  mixed: {
    label: 'Mixte', hint: 'L’emport standard : de quoi répondre en l’air et frapper au sol.',
    stores: { L1: 'R73', L2: 'R27', L3: 'B8M1', R1: 'R73', R2: 'R27', R3: 'B8M1' },
  },
};

/**
 * The armament state of one aircraft: what is on each pylon, how much is left, and
 * which station the trigger will fire next.
 */
export class Loadout {
  readonly pylons: PylonState[] = PYLONS.map((id) => ({ id, store: null, remaining: 0 }));
  gunRounds = GUN.rounds;
  /** Fires whenever the rack has to be rebuilt or the HUD redrawn. */
  onChange: (() => void) | null = null;

  constructor(preset: PresetId = 'mixed') { this.applyPreset(preset); }

  applyPreset(p: PresetId) {
    const s = PRESETS[p].stores;
    for (const py of this.pylons) this.set(py.id, s[py.id], false);
    this.onChange?.();
  }

  set(id: PylonId, store: string | null, notify = true) {
    const py = this.pylons.find((p) => p.id === id)!;
    if (store && !fits(store, id)) return false;
    py.store = store;
    py.remaining = store ? STORES[store].rounds : 0;
    if (notify) this.onChange?.();
    return true;
  }

  at(id: PylonId) { return this.pylons.find((p) => p.id === id)!; }

  /** Total mass still hanging under the wings. */
  get mass() {
    let m = 0;
    for (const p of this.pylons) {
      if (!p.store) continue;
      const sp = STORES[p.store];
      // A pod keeps most of its mass once empty; a missile rail keeps none.
      const empty = sp.kind === 'rocketpod' || sp.kind === 'dispenser';
      m += empty ? sp.mass * (0.38 + 0.62 * (p.remaining / sp.rounds)) : (p.remaining > 0 ? sp.mass : 0);
    }
    return m;
  }

  /** Drag of the same stores. An empty pod is still a pod. */
  get drag() {
    let d = 0;
    for (const p of this.pylons) {
      if (!p.store) continue;
      const sp = STORES[p.store];
      const stillThere = sp.kind === 'rocketpod' || sp.kind === 'dispenser' || p.remaining > 0;
      if (stillThere) d += sp.drag;
    }
    return d;
  }

  /** Every distinct weapon currently aboard, in selection order. */
  get available(): string[] {
    const seen: string[] = [];
    for (const p of this.pylons) {
      if (p.store && p.remaining > 0 && !seen.includes(p.store)) seen.push(p.store);
    }
    return seen;
  }

  /** Rounds left of one store type across every pylon. */
  countOf(storeId: string) {
    let n = 0;
    for (const p of this.pylons) if (p.store === storeId) n += p.remaining;
    return n;
  }

  /**
   * Pick the station to fire next. Stores come off in pairs from the outside in so
   * the aircraft stays roughly in balance — which is what a real release sequencer
   * does, and it keeps the model from developing a permanent roll.
   */
  nextStation(storeId: string, lastSide: number): PylonState | null {
    const cand = this.pylons.filter((p) => p.store === storeId && p.remaining > 0);
    if (!cand.length) return null;
    const wanted = -lastSide;
    const sorted = cand.slice().sort((a, b) => {
      const sa = sideOf(a.id) === wanted ? 0 : 1, sb = sideOf(b.id) === wanted ? 0 : 1;
      if (sa !== sb) return sa - sb;
      return stationOf(a.id) - stationOf(b.id);
    });
    return sorted[0];
  }
}
