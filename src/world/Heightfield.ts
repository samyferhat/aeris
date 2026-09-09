import * as THREE from 'three';
import { SimplexNoise, smoothstep, clamp, lerp } from '../core/Noise';

/**
 * Procedural archipelago heightfield. Generated once on the CPU (deterministic seed),
 * sampled by: terrain chunks (geometry), physics (ground contact), ocean shader (depth
 * for foam / shallow-water colour), vegetation scatter.
 *
 * World: Y up, sea level y = 0. Extent WORLD_SIZE metres centred on the origin.
 */
export const WORLD_SIZE = 9000;          // metres
export const HF_RES = 1024;              // samples per side
export const RUNWAY = {
  // Runway 09/27, along +X, centred here. Elevation & dimensions in metres.
  x: 0, z: 0, y: 14, length: 1100, width: 30, heading: 0,
};

export class Heightfield {
  readonly data = new Float32Array(HF_RES * HF_RES);
  readonly texture: THREE.DataTexture;
  readonly cell = WORLD_SIZE / (HF_RES - 1);
  readonly noise = new SimplexNoise(20260909);
  maxHeight = 0;

  constructor() {
    this.generate();
    this.texture = new THREE.DataTexture(this.data, HF_RES, HF_RES, THREE.RedFormat, THREE.FloatType);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.needsUpdate = true;
  }

  /** Analytic-ish island shape: sum of soft blobs, perturbed by low-frequency noise. */
  private islandMask(x: number, z: number): number {
    const n = this.noise;
    // Domain warp so coastlines are irregular, not circular.
    const wx = x + 600 * n.fbm2D(x * 0.00035 + 3.1, z * 0.00035, 3);
    const wz = z + 600 * n.fbm2D(x * 0.00035, z * 0.00035 + 7.7, 3);
    const blob = (cx: number, cz: number, rx: number, rz: number) => {
      const dx = (wx - cx) / rx, dz = (wz - cz) / rz;
      return 1 - smoothstep(0.55, 1.0, Math.sqrt(dx * dx + dz * dz));
    };
    let m = 0;
    m = Math.max(m, blob(-300, -700, 2300, 2000));   // main island (runway on its southern plain)
    m = Math.max(m, blob(1200, -1900, 1300, 1000));  // mountainous peninsula north-east
    m = Math.max(m, blob(2900, 1700, 1000, 850));    // second island, south-east
    m = Math.max(m, blob(-2900, 1900, 750, 650));    // small island south-west
    m = Math.max(m, blob(-3200, -2600, 500, 400));   // islet
    return m;
  }

  private heightAt(x: number, z: number): number {
    const n = this.noise;
    const mask = this.islandMask(x, z);
    // Base rolling hills.
    const hills = n.fbm2D(x * 0.0009, z * 0.0009, 5) * 0.5 + 0.5;
    // Ridged mountains, strongest in the north of the main island and on the peninsula.
    const ridge = n.ridged2D(x * 0.0007 + 11, z * 0.0007 + 5, 6);
    const mountainZone = smoothstep(200, -900, z) * smoothstep(-2600, -1200, x) * smoothstep(2600, 1400, x)
      + 0.9 * (1 - smoothstep(0, 1300, Math.hypot(x - 1200, z + 1900)));
    const detail = n.fbm2D(x * 0.006, z * 0.006, 4) * 6;
    let h = mask * (18 + 60 * hills + 640 * ridge * ridge * clamp(mountainZone, 0, 1) + detail);
    // Beaches: flatten the last few metres above sea level.
    h = h > 0 ? h - 3 * (1 - smoothstep(0, 4, h)) * 0 : h;
    // Sea floor: gentle shelf then deep.
    const shelf = -6 - 40 * (1 - mask) - 10 * hills;
    h = mask > 0.02 ? lerp(shelf, h, smoothstep(0.02, 0.35, mask)) : shelf;
    // Flatten the runway plateau with a wide, soft margin.
    const dx = Math.abs(x - RUNWAY.x), dz = Math.abs(z - RUNWAY.z);
    const rx = RUNWAY.length * 0.5 + 220, rz = RUNWAY.width * 0.5 + 260;
    const inRect = Math.max(dx - rx, dz - rz, 0);
    const flat = 1 - smoothstep(0, 320, inRect);
    h = lerp(h, RUNWAY.y + (dz > 60 ? detail * 0.15 : 0), flat);
    return h;
  }

  private generate() {
    const half = WORLD_SIZE / 2;
    for (let j = 0; j < HF_RES; j++) {
      const z = -half + j * this.cell;
      for (let i = 0; i < HF_RES; i++) {
        const x = -half + i * this.cell;
        const h = this.heightAt(x, z);
        this.data[j * HF_RES + i] = h;
        if (h > this.maxHeight) this.maxHeight = h;
      }
    }
  }

  /** Bilinear height at world (x, z). Outside the map: deep sea floor. */
  getHeight(x: number, z: number): number {
    const half = WORLD_SIZE / 2;
    const fx = (x + half) / this.cell, fz = (z + half) / this.cell;
    if (fx < 0 || fz < 0 || fx >= HF_RES - 1 || fz >= HF_RES - 1) return -60;
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const d = this.data, r = HF_RES;
    const h00 = d[j * r + i], h10 = d[j * r + i + 1], h01 = d[(j + 1) * r + i], h11 = d[(j + 1) * r + i + 1];
    return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz);
  }

  /** Ground surface (max of terrain and sea level) for physics contacts. */
  getGround(x: number, z: number): number { return Math.max(0, this.getHeight(x, z)); }

  getNormal(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    const e = this.cell;
    const hl = this.getHeight(x - e, z), hr = this.getHeight(x + e, z);
    const hd = this.getHeight(x, z - e), hu = this.getHeight(x, z + e);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  }
}
