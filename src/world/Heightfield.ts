import * as THREE from 'three';
import { SimplexNoise, smoothstep, clamp, lerp } from '../core/Noise';
import { hydraulicErosion, smooth } from './Erosion';
import {
  WORLD_SIZE, HF_RES, EROSION_RES, AIRFIELDS, AIRFIELDS as AF, CHANNEL, ISLANDS,
  elevationAt, coastAt, warp, cutWarp, newSample, Sample, Pt,
} from './Archipelago';

export { WORLD_SIZE, HF_RES, AIRFIELDS };
/** The main strip, kept under its old name because everything starts from it. */
export const RUNWAY = AF[0];

/**
 * The heightfield: the archipelago of Archipelago.ts, sampled, eroded and carved.
 *
 * It is the single source of truth for terrain geometry, ground contacts in the flight
 * model, water depth in the ocean shader, and where anything at all is allowed to be
 * placed — a house, a tree, a road, a boat.
 *
 * Erosion runs on a half-resolution copy and is added back as a delta. Droplet erosion
 * costs the same per cell whatever the cell measures, and what it produces — drainage
 * networks, valley floors, sediment fans — has a scale of hundreds of metres, so it is
 * fully resolved at 25 m. The fine field keeps its own detail and gains the valleys.
 *
 * World: Y up, sea level y = 0, extent WORLD_SIZE metres centred on the origin.
 */
export class Heightfield {
  readonly data = new Float32Array(HF_RES * HF_RES);
  readonly texture: THREE.DataTexture;
  readonly cell = WORLD_SIZE / (HF_RES - 1);
  readonly noise = new SimplexNoise(20260910);
  maxHeight = 0;
  /** 0..1 per erosion cell: how much erosion may touch it. */
  private erodeMask = new Float32Array(EROSION_RES * EROSION_RES);
  private _p: Pt = [0, 0];
  private _c: Pt = [0, 0];
  private _s: Sample = newSample();

  constructor() {
    this.texture = new THREE.DataTexture(this.data, HF_RES, HF_RES, THREE.RedFormat, THREE.FloatType);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
  }

  /** Generates the field. Yields between stages so a loading screen can repaint. */
  async generate(onProgress?: (p: number, label: string) => void) {
    const yield_ = () => new Promise((r) => setTimeout(r, 0));
    const half = WORLD_SIZE / 2;

    // ---- landform, in bands so the bar moves ------------------------------
    const BANDS = 8;
    for (let b = 0; b < BANDS; b++) {
      const j0 = Math.floor(b * HF_RES / BANDS), j1 = Math.floor((b + 1) * HF_RES / BANDS);
      for (let j = j0; j < j1; j++) {
        const z = -half + j * this.cell;
        for (let i = 0; i < HF_RES; i++) {
          const x = -half + i * this.cell;
          this.data[j * HF_RES + i] = elevationAt(x, z, this.noise, this._p, this._c, this._s);
        }
      }
      onProgress?.(0.04 + 0.30 * ((b + 1) / BANDS), 'Modelage des îles');
      await yield_();
    }

    // ---- erosion on the coarse copy ---------------------------------------
    const coarse = this.downsample();
    const base = coarse.slice();
    this.buildErodeMask();
    const mask = (i: number, j: number) => this.erodeMask[j * EROSION_RES + i];
    const coarseCell = WORLD_SIZE / (EROSION_RES - 1);
    const BATCHES = 6;
    for (let b = 0; b < BATCHES; b++) {
      hydraulicErosion(coarse, EROSION_RES, coarseCell, mask,
        { droplets: 34000, radius: 3, maxLifetime: 62 }, 1337 + b * 7919);
      onProgress?.(0.36 + 0.46 * ((b + 1) / BATCHES), 'Érosion hydraulique');
      await yield_();
    }
    smooth(coarse, EROSION_RES, 0.55, mask);
    smooth(coarse, EROSION_RES, 0.35, mask);

    // What erosion changed, put back on the fine field. The delta is smooth by
    // construction — it is the difference of two versions of the same landform — so
    // bilinear upsampling loses nothing, and the fine detail survives untouched.
    onProgress?.(0.84, 'Vallées et ravines');
    this.applyDelta(coarse, base);
    await yield_();

    // ---- carving ----------------------------------------------------------
    onProgress?.(0.90, 'Aérodromes');
    for (const af of AF) this.carveAirfield(af);
    for (let i = 0; i < this.data.length; i++) if (this.data[i] > this.maxHeight) this.maxHeight = this.data[i];
    this.texture.needsUpdate = true;
    await yield_();
  }

  // -------------------------------------------------------------------------

  private downsample(): Float32Array {
    const out = new Float32Array(EROSION_RES * EROSION_RES);
    const step = (HF_RES - 1) / (EROSION_RES - 1);
    for (let j = 0; j < EROSION_RES; j++) {
      const fj = j * step;
      for (let i = 0; i < EROSION_RES; i++) {
        out[j * EROSION_RES + i] = this.bilinear(this.data, HF_RES, i * step, fj);
      }
    }
    return out;
  }

  private bilinear(src: Float32Array, res: number, fx: number, fz: number): number {
    const i = Math.min(res - 2, Math.max(0, fx | 0)), j = Math.min(res - 2, Math.max(0, fz | 0));
    const tx = clamp(fx - i, 0, 1), tz = clamp(fz - j, 0, 1);
    const a = src[j * res + i], b = src[j * res + i + 1];
    const c = src[(j + 1) * res + i], d = src[(j + 1) * res + i + 1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
  }

  /**
   * Where water is allowed to carve. Land only, and not on anything that has been put
   * there deliberately: the strips have to stay level, and the walls of the strait have
   * to stay walls — a droplet run down an eighty-degree face will happily reduce it to
   * a scree slope, which is exactly what the strait must not become.
   */
  private buildErodeMask() {
    const half = WORLD_SIZE / 2;
    const cell = WORLD_SIZE / (EROSION_RES - 1);
    const step = (HF_RES - 1) / (EROSION_RES - 1);
    for (let j = 0; j < EROSION_RES; j++) {
      const z = -half + j * cell;
      for (let i = 0; i < EROSION_RES; i++) {
        const x = -half + i * cell;
        const h = this.bilinear(this.data, HF_RES, i * step, j * step);
        let m = smoothstep(-2, 26, h);
        for (const af of AF) {
          const [dx, dz] = this.airfieldLocal(af, x, z);
          const out = Math.max(Math.abs(dx) - af.length / 2 - 120, Math.abs(dz) - af.width / 2 - 190, 0);
          m *= smoothstep(0, 320, out);
        }
        // Distance to the strait axis, in world coordinates: the cut is authored there.
        m *= smoothstep(CHANNEL.r, CHANNEL.r + 420, this.channelDistance(x, z));
        this.erodeMask[j * EROSION_RES + i] = m;
      }
    }
  }

  /** Distance from a point to the strait's axis capsule, positive outside it. */
  private channelDistance(x: number, z: number): number {
    const ax = CHANNEL.a[0], az = CHANNEL.a[1];
    const b = CHANNEL.b ?? CHANNEL.a;
    const vx = b[0] - ax, vz = b[1] - az;
    const t = clamp(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz), 0, 1);
    return Math.hypot(x - ax - vx * t, z - az - vz * t) - CHANNEL.r;
  }

  private applyDelta(eroded: Float32Array, base: Float32Array) {
    const delta = new Float32Array(eroded.length);
    for (let k = 0; k < delta.length; k++) delta[k] = eroded[k] - base[k];
    const step = (EROSION_RES - 1) / (HF_RES - 1);
    for (let j = 0; j < HF_RES; j++) {
      const fj = j * step;
      for (let i = 0; i < HF_RES; i++) {
        this.data[j * HF_RES + i] += this.bilinear(delta, EROSION_RES, i * step, fj);
      }
    }
  }

  /** Along-strip and across-strip offsets of a point, in the airfield's own frame. */
  private airfieldLocal(af: typeof AF[number], x: number, z: number): [number, number] {
    const a = (af.heading - 90) * Math.PI / 180;
    const ca = Math.cos(a), sa = Math.sin(a);
    const px = x - af.x, pz = z - af.z;
    return [px * ca + pz * sa, -px * sa + pz * ca];
  }

  /**
   * Levels a strip and blends it into the eroded ground around it. The elevation is
   * whatever the terrain is at the middle of it, so a runway never ends up on a plinth.
   */
  carveAirfield(af: typeof AF[number]) {
    const half = WORLD_SIZE / 2;
    const n = this.noise;
    af.y = Math.round(this.getHeight(af.x, af.z) * 10) / 10;
    const apron = af.apron;
    const reachX = af.length / 2 + 120 + (apron ? Math.abs(apron.dx) + apron.w / 2 : 0);
    const reachZ = af.width / 2 + 160 + (apron ? Math.abs(apron.dz) + apron.d / 2 : 0);
    const i0 = Math.max(0, Math.floor((af.x - half * 0 - reachX - 400 + half) / this.cell));
    const i1 = Math.min(HF_RES - 1, Math.ceil((af.x + reachX + 400 + half) / this.cell));
    const j0 = Math.max(0, Math.floor((af.z - reachZ - 400 + half) / this.cell));
    const j1 = Math.min(HF_RES - 1, Math.ceil((af.z + reachZ + 400 + half) / this.cell));
    for (let j = j0; j <= j1; j++) {
      const z = -half + j * this.cell;
      for (let i = i0; i <= i1; i++) {
        const x = -half + i * this.cell;
        const [dx, dz] = this.airfieldLocal(af, x, z);
        let out = Math.max(Math.abs(dx) - (af.length / 2 + 90), Math.abs(dz) - (af.width / 2 + 110), 0);
        if (apron) {
          out = Math.min(out, Math.max(Math.abs(dx - apron.dx) - apron.w / 2 - 25,
                                       Math.abs(dz - apron.dz) - apron.d / 2 - 25, 0));
        }
        const flat = 1 - smoothstep(0, 300, out);
        if (flat <= 0.001) continue;
        const k = j * HF_RES + i;
        // Dead level over the strip itself, gently undulating grass around it.
        const strip = 1 - smoothstep(af.width / 2 + 6, af.width / 2 + 55, Math.abs(dz));
        const target = af.y + (1 - strip) * 1.5 * n.fbm2D(x * 0.004, z * 0.004, 2);
        this.data[k] = lerp(this.data[k], target, flat);
      }
    }
  }

  // ---- carving ------------------------------------------------------------

  /**
   * Levels a rotated rectangle of ground to `target`, feathering out over `feather`
   * metres. This is how a plot is cut into a hillside; done for every building in a hill
   * town it produces the terraces, in the ground rather than under the geometry.
   */
  flattenRect(cx: number, cz: number, w: number, d: number, rot: number, target: number, feather: number) {
    const half = WORLD_SIZE / 2;
    const ca = Math.cos(-rot), sa = Math.sin(-rot);
    const reach = Math.hypot(w, d) / 2 + feather;
    const i0 = Math.max(0, Math.floor((cx - reach + half) / this.cell));
    const i1 = Math.min(HF_RES - 1, Math.ceil((cx + reach + half) / this.cell));
    const j0 = Math.max(0, Math.floor((cz - reach + half) / this.cell));
    const j1 = Math.min(HF_RES - 1, Math.ceil((cz + reach + half) / this.cell));
    for (let j = j0; j <= j1; j++) {
      const z = -half + j * this.cell;
      for (let i = i0; i <= i1; i++) {
        const x = -half + i * this.cell;
        const dx = x - cx, dz = z - cz;
        const lx = Math.abs(dx * ca - dz * sa) - w / 2;
        const lz = Math.abs(dx * sa + dz * ca) - d / 2;
        const out = Math.hypot(Math.max(lx, 0), Math.max(lz, 0));
        const k = 1 - smoothstep(0, feather, out);
        if (k <= 0.001) continue;
        const idx = j * HF_RES + i;
        this.data[idx] = lerp(this.data[idx], target, k);
      }
    }
  }

  /** The same, along a segment: a street cut into the slope. */
  flattenSegment(x0: number, z0: number, x1: number, z1: number, width: number, target: number, feather: number) {
    const half = WORLD_SIZE / 2;
    const vx = x1 - x0, vz = z1 - z0;
    const vv = vx * vx + vz * vz;
    const reach = width / 2 + feather;
    const i0 = Math.max(0, Math.floor((Math.min(x0, x1) - reach + half) / this.cell));
    const i1 = Math.min(HF_RES - 1, Math.ceil((Math.max(x0, x1) + reach + half) / this.cell));
    const j0 = Math.max(0, Math.floor((Math.min(z0, z1) - reach + half) / this.cell));
    const j1 = Math.min(HF_RES - 1, Math.ceil((Math.max(z0, z1) + reach + half) / this.cell));
    for (let j = j0; j <= j1; j++) {
      const z = -half + j * this.cell;
      for (let i = i0; i <= i1; i++) {
        const x = -half + i * this.cell;
        const t = vv > 1e-6 ? clamp(((x - x0) * vx + (z - z0) * vz) / vv, 0, 1) : 0;
        const dd = Math.hypot(x - x0 - vx * t, z - z0 - vz * t) - width / 2;
        const k = 1 - smoothstep(0, feather, Math.max(dd, 0));
        if (k <= 0.001) continue;
        const idx = j * HF_RES + i;
        this.data[idx] = lerp(this.data[idx], target, k * 0.92);
      }
    }
  }

  /**
   * Re-levels every strip. Called last, after the settlement has cut its streets: a road
   * routed to the airfield was carved straight across the runway and left a ten-metre
   * trench in it, which the aeroplane found before the pilot did.
   */
  carveAirfields() { for (const af of AF) this.carveAirfield(af); }

  /** Pushes the carved field back to the GPU; call once when all carving is done. */
  commit() {
    this.maxHeight = 0;
    for (let i = 0; i < this.data.length; i++) if (this.data[i] > this.maxHeight) this.maxHeight = this.data[i];
    this.texture.needsUpdate = true;
  }

  // ---- queries ------------------------------------------------------------

  /** Bilinear height at world (x, z). Outside the map: deep sea floor. */
  getHeight(x: number, z: number): number {
    const half = WORLD_SIZE / 2;
    const fx = (x + half) / this.cell, fz = (z + half) / this.cell;
    if (fx < 0 || fz < 0 || fx >= HF_RES - 1 || fz >= HF_RES - 1) return -180;
    const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j;
    const d = this.data, r = HF_RES;
    const h00 = d[j * r + i], h10 = d[j * r + i + 1], h01 = d[(j + 1) * r + i], h11 = d[(j + 1) * r + i + 1];
    return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz);
  }

  /** Ground surface (terrain or sea level) for physics contacts. */
  getGround(x: number, z: number): number { return Math.max(0, this.getHeight(x, z)); }

  /**
   * Signed distance to the nearest coastline, negative inland. Recomputed rather than
   * stored: it costs a few hundred nanoseconds and it is only ever asked for when
   * something is being placed.
   */
  coastDistance(x: number, z: number): number {
    warp(x, z, this.noise, this._p);
    cutWarp(x, z, this.noise, this._c);
    coastAt(this._p[0], this._p[1], this._c[0], this._c[1], this._s);
    return this._s.sdf;
  }

  /** Which island a point belongs to, or is nearest to. */
  islandAt(x: number, z: number) {
    this.coastDistance(x, z);
    return ISLANDS[this._s.island];
  }

  /**
   * Surface normal. `spacing` should match the sampling of the mesh being built: a
   * coarse tile that samples every 30 m but takes its normals from the 12 m grid picks
   * up every erosion rill, and at a distance those alias into shimmering flutes.
   */
  getNormal(x: number, z: number, out = new THREE.Vector3(), spacing = this.cell): THREE.Vector3 {
    const e = Math.max(this.cell, spacing);
    const hl = this.getHeight(x - e, z), hr = this.getHeight(x + e, z);
    const hd = this.getHeight(x, z - e), hu = this.getHeight(x, z + e);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  }

  /** Steepness 0 (flat) .. 1 (vertical), used for vegetation and material blending. */
  getSlope(x: number, z: number): number {
    const nrm = this.getNormal(x, z);
    return 1 - nrm.y;
  }
}
