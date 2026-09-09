import * as THREE from 'three';
import { SimplexNoise, smoothstep, clamp, lerp } from '../core/Noise';
import { hydraulicErosion, smooth } from './Erosion';

/**
 * Procedural archipelago heightfield.
 *
 * Built in two stages: a landform pass (island masks + broad ridged massifs + hills),
 * then a hydraulic-erosion pass that carves the drainage network. The erosion is what
 * makes it read as a real place rather than as noise — see Erosion.ts.
 *
 * It is the single source of truth for: terrain geometry, ground contacts in the flight
 * model, water depth in the ocean shader, and vegetation placement.
 *
 * World: Y up, sea level y = 0, extent WORLD_SIZE metres centred on the origin.
 */
export const WORLD_SIZE = 9000;
export const HF_RES = 1024;
export const RUNWAY = {
  // Runway 09/27, aligned with +X, centred here. Metres.
  x: 0, z: 0, y: 14, length: 1100, width: 30,
};

export class Heightfield {
  readonly data = new Float32Array(HF_RES * HF_RES);
  readonly texture: THREE.DataTexture;
  readonly cell = WORLD_SIZE / (HF_RES - 1);
  readonly noise = new SimplexNoise(20260909);
  maxHeight = 0;
  /** 0..1 per cell: how much erosion was allowed to touch it (also used for scree shading). */
  private erodeMask = new Float32Array(HF_RES * HF_RES);

  constructor() {
    this.texture = new THREE.DataTexture(this.data, HF_RES, HF_RES, THREE.RedFormat, THREE.FloatType);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
  }

  /** Generates the field. Yields between stages so a loading screen can repaint. */
  async generate(onProgress?: (p: number, label: string) => void) {
    const yield_ = () => new Promise((r) => setTimeout(r, 0));
    onProgress?.(0, 'Modelage du relief');
    this.landform();
    await yield_();
    onProgress?.(0.35, 'Érosion hydraulique');
    // Chunked so the browser can paint between batches.
    const BATCHES = 6, PER = 26000;
    for (let b = 0; b < BATCHES; b++) {
      hydraulicErosion(this.data, HF_RES, this.cell, (i, j) => this.erodeMask[j * HF_RES + i], { droplets: PER, radius: 3 }, 1337 + b * 7919);
      onProgress?.(0.35 + 0.5 * ((b + 1) / BATCHES), 'Érosion hydraulique');
      await yield_();
    }
    smooth(this.data, HF_RES, 0.45, (i, j) => this.erodeMask[j * HF_RES + i]);
    onProgress?.(0.92, 'Finition du terrain');
    this.carveRunway();
    for (let i = 0; i < this.data.length; i++) if (this.data[i] > this.maxHeight) this.maxHeight = this.data[i];
    this.texture.needsUpdate = true;
    await yield_();
  }

  /** Soft island silhouettes, warped so no coastline is a circle. Returns 0..1. */
  private islandMask(x: number, z: number): number {
    const n = this.noise;
    const wx = x + 620 * n.fbm2D(x * 0.00033 + 3.1, z * 0.00033, 3);
    const wz = z + 620 * n.fbm2D(x * 0.00033, z * 0.00033 + 7.7, 3);
    const blob = (cx: number, cz: number, rx: number, rz: number) => {
      const dx = (wx - cx) / rx, dz = (wz - cz) / rz;
      return 1 - smoothstep(0.5, 1.0, Math.hypot(dx, dz));
    };
    return Math.max(
      blob(-300, -700, 2400, 2050),    // main island: runway on its southern plain
      blob(1250, -2000, 1350, 1050),   // mountainous north-east peninsula
      blob(2900, 1700, 1000, 850),     // south-east island
      blob(-2950, 1900, 780, 660),     // south-west island
      blob(-3200, -2600, 520, 430),    // islet
    );
  }

  private landform() {
    const n = this.noise;
    const half = WORLD_SIZE / 2;
    for (let j = 0; j < HF_RES; j++) {
      const z = -half + j * this.cell;
      for (let i = 0; i < HF_RES; i++) {
        const x = -half + i * this.cell;
        const mask = this.islandMask(x, z);
        // Where the high ground is: a slow field, so massifs have a scale of kilometres.
        const massif = smoothstep(0.12, 0.72, n.fbm2D(x * 0.00021 + 41, z * 0.00021 - 17, 3) * 0.5 + 0.5);
        // Broad ridge lines. Not squared: squaring turns ridges into needles.
        const ridge = n.ridged2D(x * 0.00040 + 11, z * 0.00040 + 5, 5, 2.05, 0.48);
        const mountains = 780 * massif * Math.pow(ridge, 1.35);
        const hills = 58 * (n.fbm2D(x * 0.0011, z * 0.0011, 4) * 0.5 + 0.5);
        const detail = 7 * n.fbm2D(x * 0.0052, z * 0.0052, 3);
        let h = 9 + hills + mountains + detail;
        // Coastal shelf then deep water outside the island masks.
        const shelf = -7 - 46 * (1 - mask) - 9 * (hills / 58);
        h = lerp(shelf, h, smoothstep(0.0, 0.34, mask));
        const k = j * HF_RES + i;
        this.data[k] = h;
        // Erode land above the waterline; leave the sea floor and the airfield alone.
        const dx = Math.abs(x - RUNWAY.x), dz = Math.abs(z - RUNWAY.z);
        const nearField = 1 - smoothstep(0, 260, Math.max(dx - (RUNWAY.length / 2 + 90), dz - (RUNWAY.width / 2 + 120), 0));
        this.erodeMask[k] = smoothstep(-1, 14, h) * (1 - nearField);
      }
    }
  }

  /** Flattens the runway plateau and blends it into the eroded terrain around it. */
  private carveRunway() {
    const half = WORLD_SIZE / 2;
    const n = this.noise;
    for (let j = 0; j < HF_RES; j++) {
      const z = -half + j * this.cell;
      for (let i = 0; i < HF_RES; i++) {
        const x = -half + i * this.cell;
        const dx = Math.abs(x - RUNWAY.x), dz = Math.abs(z - RUNWAY.z);
        const out = Math.max(dx - (RUNWAY.length / 2 + 95), dz - (RUNWAY.width / 2 + 125), 0);
        const flat = 1 - smoothstep(0, 210, out);
        if (flat <= 0.001) continue;
        const k = j * HF_RES + i;
        // Perfectly level over the strip itself, gently undulating grass around it.
        const strip = 1 - smoothstep(RUNWAY.width / 2 + 6, RUNWAY.width / 2 + 60, dz);
        const target = RUNWAY.y + (1 - strip) * 1.6 * n.fbm2D(x * 0.004, z * 0.004, 2);
        this.data[k] = lerp(this.data[k], target, flat);
      }
    }
  }

  /** Bilinear height at world (x, z). Outside the map: deep sea floor. */
  getHeight(x: number, z: number): number {
    const half = WORLD_SIZE / 2;
    const fx = (x + half) / this.cell, fz = (z + half) / this.cell;
    if (fx < 0 || fz < 0 || fx >= HF_RES - 1 || fz >= HF_RES - 1) return -60;
    const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j;
    const d = this.data, r = HF_RES;
    const h00 = d[j * r + i], h10 = d[j * r + i + 1], h01 = d[(j + 1) * r + i], h11 = d[(j + 1) * r + i + 1];
    return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz);
  }

  /** Ground surface (terrain or sea level) for physics contacts. */
  getGround(x: number, z: number): number { return Math.max(0, this.getHeight(x, z)); }

  getNormal(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    const e = this.cell;
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
