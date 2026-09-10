import { SimplexNoise, smoothstep, clamp, lerp } from '../core/Noise';

/**
 * The archipelago: where the islands are, what shape they take, and what sits on them.
 *
 * This module is pure arithmetic — no THREE, no browser — so the same code can be run
 * from node to render a top-down map while the layout is being designed
 * (`node tools/mapview.ts`). Heightfield.ts turns what is here into an actual field.
 *
 * World frame: +X east, +Z south, Y up, sea level y = 0, origin at the middle of the map.
 *
 * Shapes are signed distance fields. An island is a union of capsules (a segment with a
 * radius; a segment of zero length is a disc), from which bays and channels are
 * subtracted. Working in distances rather than in blobs means the coastline can be told
 * how fast to rise — a beach and a cliff are the same operator with a different width —
 * and it gives every point a cheap "how far out to sea am I" that the reef, the surf and
 * the water colour all read from.
 */

export const WORLD_SIZE = 26000;
export const HF_RES = 2048;
/** Erosion runs on a half-resolution copy; its result is added back as a smooth delta. */
export const EROSION_RES = 1024;

export type Pt = [number, number];
/** A capsule: the set of points within `r` of the segment a–b. a === b gives a disc. */
export interface Lobe { a: Pt; b?: Pt; r: number }

/**
 * A capsule subtracted from the land: a bay, or a channel cut clean through it.
 *
 * Cuts are evaluated in world coordinates, not in the warped ones the coastlines use.
 * A bay is allowed to end up a kilometre from where it was written; the strait is not —
 * the bridge has to be built over it, and the cliffs have to be the cliffs on the map.
 */
export interface Cut extends Lobe {
  /** Coastal rise inside this cut, in metres of horizontal run. 40 = sea cliff. */
  shore?: number;
  /** Depth in the middle. Set on channels, so they read as navigable, not as a lagoon. */
  depth?: number;
}

export interface IslandSpec {
  id: string;
  name: string;
  /** Land, unioned smoothly. */
  lobes: Lobe[];
  /** Subtracted from the land. Bays are wide and round, channels are long and thin. */
  cuts?: Cut[];
  /** Summit position and height in metres. */
  peak: Pt;
  peakH: number;
  /** Radius over which the cone falls from the summit to the coastal plain. */
  spread: number;
  /** 0 = smooth dome, 1 = deeply gullied volcanic flanks. */
  ridge: number;
  /** Coastal rise, metres of horizontal run. 300 = long beach, 45 = sea cliff. */
  shore: number;
  /** Width of the fringing reef flat in metres. 0 = the island drops straight off. */
  reef: number;
  /** Extra fall-off exponent: >1 concentrates the height near the summit. */
  cone?: number;
  /** Secondary summits, unioned with the main cone by a plain maximum. */
  ridges?: { p: Pt; h: number; spread: number }[];
}

// ---------------------------------------------------------------------------
// Layout
//
// Roughly 25 km corner to corner, which is the size asked for: long enough that
// crossing it is a trip, small enough to learn by heart. Everything is placed by hand.
// The one rule the layout obeys is that the strait has to be on the way between the
// airfield and anywhere worth going, so it gets flown often.
// ---------------------------------------------------------------------------

/**
 * The two cuts that shape the main island, named because more than one island subtracts
 * them and because the port and the bridge are placed relative to them.
 *
 * The channel runs east-south-east from the open sea into the bay, so the strait is not
 * a detour: it is the short way home from the west, and it comes out over the city.
 */
export const CHANNEL: Cut = { a: [-7600, -4100], b: [-3800, -800], r: 175, shore: 38, depth: -34 };
export const BAY: Cut = { a: [-2400, -700], b: [-3400, -1500], r: 1150, depth: -16 };

export const ISLANDS: IslandSpec[] = [
  {
    id: 'grande', name: 'Grande Île',
    lobes: [
      { a: [-6100, 900], r: 2500 },                     // the massif
      { a: [-6300, 700], b: [-3500, 2600], r: 1750 },   // south-east ridge running down
      { a: [-4000, 2200], b: [-700, 900], r: 1450 },    // the eastern plain: the airfield
      { a: [-6520, -1506], b: [-5900, -400], r: 1500 },  // the northern arm, cut by the strait
      { a: [-7700, 2200], r: 1150 },                    // south-western headland
    ],
    cuts: [BAY, CHANNEL],
    peak: [-6100, 800], peakH: 1080, spread: 4200, ridge: 0.85, shore: 210, reef: 620,
    ridges: [
      { p: [-4600, 2500], h: 540, spread: 2100 },   // the south ridge, above the west coast
      { p: [-6000, -1800], h: 320, spread: 1550 },  // the south-west wall of the strait
      { p: [-2600, 1400], h: 210, spread: 1900 },   // the hills behind the airfield
      { p: [-7600, 2200], h: 300, spread: 1200 },   // the south-western headland
    ],
  },
  {
    id: 'detroit', name: 'Île du Détroit',
    // The far bank of the strait: the same rock, severed by the same cut.
    lobes: [
      { a: [-4880, -3394], b: [-3900, -2500], r: 1400 },
      { a: [-6000, -4000], r: 1050 },
    ],
    cuts: [CHANNEL],
    peak: [-4900, -3300], peakH: 380, spread: 1700, ridge: 0.72, shore: 110, reef: 260,
    ridges: [{ p: [-5250, -3050], h: 300, spread: 1150 }],  // the north-east wall
  },
  {
    id: 'ponant', name: 'Ponant',
    lobes: [
      { a: [3500, -5000], r: 1500 },
      { a: [3900, -5400], b: [5300, -6100], r: 900 },   // the plain with the short strip
    ],
    peak: [3200, -4900], peakH: 520, spread: 1750, ridge: 0.6, shore: 260, reef: 900,
  },
  {
    id: 'levant', name: 'Levant',
    lobes: [
      { a: [5300, 3500], r: 1300 },
      { a: [5800, 3900], b: [6900, 4600], r: 780 },
    ],
    peak: [5100, 3300], peakH: 440, spread: 1500, ridge: 0.62, shore: 240, reef: 1000,
  },
  {
    id: 'phare', name: 'Îlot du Phare',
    lobes: [{ a: [9500, 500], b: [9800, 900], r: 420 }],
    peak: [9600, 700], peakH: 74, spread: 620, ridge: 0.35, shore: 60, reef: 260,
  },
  {
    id: 'epave', name: 'Banc de l’Épave',
    lobes: [{ a: [-1800, 7400], b: [-900, 7700], r: 640 }],
    peak: [-1400, 7550], peakH: 26, spread: 900, ridge: 0.2, shore: 340, reef: 1300,
  },
  {
    id: 'aiguilles', name: 'Les Aiguilles',
    lobes: [{ a: [1100, -8000], r: 330 }, { a: [1700, -8500], r: 210 }],
    peak: [1150, -8050], peakH: 96, spread: 420, ridge: 0.9, shore: 42, reef: 0,
  },
  {
    id: 'sec', name: 'Sec du Sud-Est',
    lobes: [{ a: [8000, -5400], r: 300 }],
    peak: [8000, -5400], peakH: 58, spread: 380, ridge: 0.8, shore: 50, reef: 480,
  },
];

// ---------------------------------------------------------------------------
// Places
// ---------------------------------------------------------------------------

export interface AirfieldSpec {
  id: string; name: string;
  x: number; z: number; y: number;
  length: number; width: number;
  /** Compass heading of the strip in degrees; the reciprocal is implied. */
  heading: number;
  apron?: { dx: number; dz: number; w: number; d: number };
}

/**
 * Runway 09/27 on the eastern plain of the main island. Kept at the origin: it is where
 * every flight starts, and half the debug entry points in main.ts are written relative
 * to it. `y` is filled in during generation from the terrain it ends up on.
 */
export const AIRFIELDS: AirfieldSpec[] = [
  { id: 'main', name: 'Aérodrome principal', x: -480, z: 500, y: 34, length: 1250, width: 34, heading: 90, apron: { dx: -430, dz: 130, w: 160, d: 84 } },
  { id: 'ponant', name: 'Ponant', x: 5020, z: -5700, y: 32, length: 620, width: 18, heading: 118, apron: { dx: -170, dz: 62, w: 62, d: 42 } },
  { id: 'levant', name: 'Levant', x: 6720, z: 3640, y: 31, length: 560, width: 18, heading: 58, apron: { dx: -150, dz: 58, w: 58, d: 40 } },
];

export const RUNWAY = AIRFIELDS[0];

/** The port city, on the sheltered side of the bay, climbing the hill behind it. */
export const PORT = {
  /** Centre of the old town, on the waterfront. */
  x: -3120, z: 320,
  /** The bay's mouth: the quays face this way. */
  facing: [0.55, -0.84] as Pt,
  /** Radius of the dense centre, and of the whole built-up area. */
  core: 620, sprawl: 2100,
};

export const VILLAGES = [
  { id: 'ponant', name: 'Ponant', x: 3080, z: -6440, r: 270 },
  { id: 'levant', name: 'Levant', x: 4940, z: 2940, r: 250 },
  { id: 'anse', name: 'L’Anse', x: -6600, z: 3400, r: 200 },
];

/**
 * The strait, and the suspension bridge over it. A 350 m channel between walls that
 * stand about 250 m out of the water. The deck is deliberately low: going under it is
 * the point, and there is a comfortable hundred metres to do it in.
 */
export const STRAIT = {
  a: CHANNEL.a, b: CHANNEL.b,
  halfWidth: CHANNEL.r,
  /** Where the bridge crosses, as a fraction along the axis. */
  at: 0.50,
  deckHeight: 168,
  span: 900,
  towerHeight: 96,
};

export const LIGHTHOUSE = { x: 9660, z: 780, height: 34 };
/** A freighter aground on the outer reef, canted over. */
export const WRECK = { x: -2680, z: 6520, heading: 2.05, roll: 0.30 };

// ---------------------------------------------------------------------------
// Signed distance field
// ---------------------------------------------------------------------------

function sdCapsule(px: number, pz: number, l: Lobe): number {
  const ax = l.a[0], az = l.a[1];
  const b = l.b ?? l.a;
  const bx = b[0], bz = b[1];
  const vx = bx - ax, vz = bz - az;
  const wx = px - ax, wz = pz - az;
  const vv = vx * vx + vz * vz;
  const t = vv > 1e-6 ? clamp((wx * vx + wz * vz) / vv, 0, 1) : 0;
  const dx = wx - vx * t, dz = wz - vz * t;
  return Math.hypot(dx, dz) - l.r;
}

/** Polynomial smooth minimum: unions two shapes with a fillet instead of a crease. */
function smin(a: number, b: number, k: number): number {
  const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1);
  return lerp(b, a, h) - k * h * (1 - h);
}

/** Bounding radius of an island, used to skip it cheaply. */
function islandBound(s: IslandSpec): { cx: number; cz: number; r: number } {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const l of s.lobes) for (const p of [l.a, l.b ?? l.a]) {
    minX = Math.min(minX, p[0] - l.r); maxX = Math.max(maxX, p[0] + l.r);
    minZ = Math.min(minZ, p[1] - l.r); maxZ = Math.max(maxZ, p[1] + l.r);
  }
  return { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, r: Math.hypot(maxX - minX, maxZ - minZ) / 2 };
}

const BOUNDS = ISLANDS.map(islandBound);

export interface Sample {
  /** Signed distance to the coast in metres; negative inland. */
  sdf: number;
  /** Which island owns this point (nearest), even far out to sea. */
  island: number;
  /** Nearest cut, and 0..1 for how far inside it the point is (1 = on its axis). */
  cut: Cut | null;
  cutT: number;
  /** Signed distance to that cut, negative inside it. */
  cutD: number;
}

export const newSample = (): Sample => ({ sdf: 0, island: 0, cut: null, cutT: 0, cutD: 1e9 });

/** Every distinct cut in the archipelago; bays and channels are shared between islands. */
const ALL_CUTS: Cut[] = [];
for (const s of ISLANDS) if (s.cuts) for (const c of s.cuts) if (!ALL_CUTS.includes(c)) ALL_CUTS.push(c);

/**
 * Distance to the coastline of the whole archipelago, and which island is nearest.
 *
 * Two sets of coordinates go in. `wx, wz` are warped hard, and the land lobes are
 * measured there, which is what stops any coastline from being an arc. `cx, cz` are
 * barely warped at all, and the cuts are measured there, so a bay stays a bay and the
 * strait stays where the bridge is going to be built.
 */
export function coastAt(wx: number, wz: number, cx: number, cz: number, out: Sample): Sample {
  out.cut = null; out.cutT = 0; out.cutD = 1e9;
  for (const c of ALL_CUTS) {
    const d = sdCapsule(cx, cz, c);
    if (d < out.cutD) { out.cutD = d; out.cut = c; }
  }
  out.cutT = out.cutD < 0 ? clamp(-out.cutD / (out.cut as Cut).r, 0, 1) : 0;

  let best = Infinity, bestI = 0;
  for (let i = 0; i < ISLANDS.length; i++) {
    const s = ISLANDS[i], bb = BOUNDS[i];
    // Cheap reject: further out than this, the exact value does not matter, only that
    // it is large and increases with distance.
    const dc = Math.hypot(wx - bb.cx, wz - bb.cz) - bb.r;
    if (dc > 2600) { if (dc < best) { best = dc; bestI = i; } continue; }
    // Seeded with the first lobe rather than with Infinity: the smooth minimum
    // interpolates towards its arguments, and interpolating towards infinity by zero is
    // not zero, it is NaN.
    let d = sdCapsule(wx, wz, s.lobes[0]);
    for (let k = 1; k < s.lobes.length; k++) d = smin(d, sdCapsule(wx, wz, s.lobes[k]), 260);
    if (s.cuts) for (const c of s.cuts) d = Math.max(d, -sdCapsule(cx, cz, c));
    if (d < best) { best = d; bestI = i; }
  }
  out.sdf = best; out.island = bestI;
  return out;
}

/** Domain warp for the coastlines. Kilometre scale: headlands and inlets, not wobble. */
export function warp(x: number, z: number, n: SimplexNoise, out: Pt): Pt {
  const a = n.fbm2D(x * 0.00019 + 3.1, z * 0.00019 - 1.7, 2);
  const b = n.fbm2D(x * 0.00019 - 8.3, z * 0.00019 + 5.5, 2);
  const c = n.fbm2D(x * 0.00072 + 21.0, z * 0.00072 + 11.0, 2);
  out[0] = x + 900 * a + 190 * c;
  out[1] = z + 900 * b - 190 * c;
  return out;
}

/** Domain warp for the cuts. Just enough that a channel is not a drawn rectangle. */
export function cutWarp(x: number, z: number, n: SimplexNoise, out: Pt): Pt {
  out[0] = x + 105 * n.fbm2D(x * 0.00085 + 55, z * 0.00085 - 12, 2);
  out[1] = z + 105 * n.fbm2D(x * 0.00085 - 71, z * 0.00085 + 34, 2);
  return out;
}

// ---------------------------------------------------------------------------
// Elevation
// ---------------------------------------------------------------------------

/**
 * Land height above sea level at a point, before erosion.
 *
 * Three terms multiply: a volcanic cone falling from the summit, a ridged field for the
 * crests between the valleys, and the coastal rise, which is what decides whether the
 * island ends in a beach or in a cliff.
 */
function landHeight(x: number, z: number, sm: Sample, s: IslandSpec, n: SimplexNoise): number {
  const sdf = sm.sdf;
  // A volcano is concave near the summit and convex at the foot; (1 - t) to a power
  // gets both from one term, and the exponent per island tunes how sharp the peak is.
  const conePart = (p: Pt, spread: number, k: number) =>
    Math.pow(1 - clamp(Math.hypot(x - p[0], z - p[1]) / spread, 0, 1), k);

  let cone = conePart(s.peak, s.spread, s.cone ?? 1.75);
  let relief = s.peakH * cone;
  // Secondary massifs: a real island is rarely a single cone, and the saddles between
  // summits are where the valleys and the roads go.
  if (s.ridges) for (const r of s.ridges) {
    const c = conePart(r.p, r.spread, 1.6);
    relief = Math.max(relief, r.h * c);
    cone = Math.max(cone, c);
  }

  // Ridge network. Plain ridged noise at a kilometre scale: the radial gullies come
  // from the erosion pass, which runs water downhill from the summit and does a far
  // better job of it than any amount of noise shaping.
  const ridged = n.ridged2D(x * 0.00046 + s.peak[0] * 0.0004, z * 0.00046 + s.peak[1] * 0.0004, 5, 2.07, 0.5);
  const ridgeMix = lerp(0.70, 0.30 + ridged * 1.35, s.ridge);

  const hills = 78 * (n.fbm2D(x * 0.00062 + 11, z * 0.00062 - 4, 4) * 0.5 + 0.5) * (0.30 + 0.70 * cone)
              + 26 * (n.fbm2D(x * 0.0016 - 21, z * 0.0016 + 33, 3) * 0.5 + 0.5);
  const detail = 9 * n.fbm2D(x * 0.0042, z * 0.0042, 3);

  // The coastal rise. Sharp where the island is cliffy, long where it is a beach; the
  // width itself wanders so one island has both. A cut with a shore of its own — the
  // strait — overrides it near its walls, and that override is the cliff.
  const shoreVar = 0.55 + 0.9 * (n.fbm2D(x * 0.00055 - 30, z * 0.00055 + 17, 3) * 0.5 + 0.5);
  let width = Math.max(30, s.shore * shoreVar);
  if (sm.cut && sm.cut.shore !== undefined) {
    const k = 1 - smoothstep(0, 480, sm.cutD);
    if (k > 0) width = lerp(width, sm.cut.shore, k);
  }
  const rise = smoothstep(0, width, -sdf);

  return (relief * ridgeMix + hills + detail) * Math.pow(rise, 0.85) + 2.2 * rise;
}

/**
 * Sea floor depth (negative) at a point outside the coast.
 *
 * The shape of the bottom is most of what the water will look like from the air, so it
 * is built the way the real thing is: a shallow reef flat fringing the island, a crest
 * at its outer edge where the swell trips and breaks white, then the fore-reef dropping
 * away into the blue. Coral heads are bumps on the flat and show through as dark patches.
 */
function seaDepth(x: number, z: number, sm: Sample, s: IslandSpec, n: SimplexNoise): number {
  const d = sm.sdf;                                // metres offshore
  const reefVar = 0.6 + 0.8 * (n.fbm2D(x * 0.00042 + 61, z * 0.00042 - 23, 3) * 0.5 + 0.5);
  const flat = s.reef * reefVar;

  let h: number;
  if (flat < 20) {
    // No reef: the flank simply carries on under water.
    h = -3 - 130 * smoothstep(0, 900, d) - 190 * smoothstep(700, 4200, d);
  } else {
    // Lagoon floor, dishing gently outwards from the beach.
    const lagoon = -1.1 - 5.2 * smoothstep(0, flat * 0.85, d);
    // The crest: a bar that comes back up to just under the surface.
    const crestPos = flat, crestW = Math.max(70, flat * 0.22);
    const crest = 4.0 * Math.exp(-Math.pow((d - crestPos) / crestW, 2));
    // Fore-reef, then the drop-off.
    const outer = -60 * smoothstep(flat, flat + 700, d) - 210 * smoothstep(flat + 500, flat + 3800, d);
    h = lagoon + crest + outer;
  }
  // Coral heads and sand ripples on the shallows, and long swells on the deep floor.
  // Both are gated: seventy per cent of the map is deep water, and paying eight octaves
  // of noise per cell out there is most of the generation time for none of the picture.
  const shallowN = 1 - smoothstep(0, 40, -h);
  if (shallowN > 0.01) h += shallowN * 2.4 * n.fbm2D(x * 0.0032 + 7, z * 0.0032 + 19, 4);
  const deepN = smoothstep(30, 160, -h);
  if (deepN > 0.01) h += 14 * n.fbm2D(x * 0.00031 - 44, z * 0.00031 + 9, 3) * deepN;
  // Water that has been cut, rather than left over: a bay is dredged flat and a channel
  // is deep in the middle, and neither of them grows coral across the fairway.
  if (sm.cut && sm.cut.depth !== undefined && sm.cutT > 0) {
    h = lerp(h, sm.cut.depth, smoothstep(0.0, 0.55, sm.cutT));
  }
  // The archipelago sits on one platform: the water between two islands should read as
  // passable, not as an abyss.
  return Math.max(h, -420);
}

/** Ground or sea-floor height at one point, before erosion. */
export function elevationAt(x: number, z: number, n: SimplexNoise, tmpP: Pt, tmpC: Pt, out: Sample): number {
  warp(x, z, n, tmpP);
  cutWarp(x, z, n, tmpC);
  coastAt(tmpP[0], tmpP[1], tmpC[0], tmpC[1], out);
  const s = ISLANDS[out.island];
  // Past the blend band the land term is multiplied by zero, so do not compute it. It is
  // the expensive half of the field and most of the map is past that band.
  const k = smoothstep(0, 55, out.sdf);
  if (k >= 1) return seaDepth(x, z, out, s, n);
  const land = landHeight(x, z, out, s, n);
  if (out.sdf < 0) return land;
  return lerp(land, seaDepth(x, z, out, s, n), k);
}

/**
 * How steep the coast is here, 0 = beach, 1 = cliff. The terrain shader uses it to put
 * bare rock on the sea cliffs, and the vegetation to stay off them.
 */
export function shoreCliffness(s: IslandSpec): number {
  return clamp((260 - s.shore) / 210, 0, 1);
}
