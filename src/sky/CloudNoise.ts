import * as THREE from 'three';
import { mulberry32 } from '../core/Noise';

/**
 * Tileable 3D noise for volumetric clouds, generated on the CPU once:
 *   R = Perlin-Worley (cloud shape), G/B/A = Worley at increasing frequency (erosion).
 * Plus a 2D "weather" texture: R = coverage, G = cloud type (height profile), B = unused.
 */

/** Periodic 3D gradient noise on an integer lattice (tileable with period p). */
function makePerlin(period: number, seed: number) {
  const rnd = mulberry32(seed);
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256); for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const grad = (h: number, x: number, y: number, z: number) => {
    const u = h < 8 ? x : y, v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  };
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a: number, b: number, t: number) => a + t * (b - a);
  return (x: number, y: number, z: number) => {
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    const xf = x - X, yf = y - Y, zf = z - Z;
    const u = fade(xf), v = fade(yf), w = fade(zf);
    const P = (i: number, j: number, k: number) => perm[(perm[(perm[((i % period) + period) % period & 255] + ((j % period) + period) % period) & 255] + ((k % period) + period) % period) & 255] & 15;
    return lerp(
      lerp(lerp(grad(P(X, Y, Z), xf, yf, zf), grad(P(X + 1, Y, Z), xf - 1, yf, zf), u), lerp(grad(P(X, Y + 1, Z), xf, yf - 1, zf), grad(P(X + 1, Y + 1, Z), xf - 1, yf - 1, zf), u), v),
      lerp(lerp(grad(P(X, Y, Z + 1), xf, yf, zf - 1), grad(P(X + 1, Y, Z + 1), xf - 1, yf, zf - 1), u), lerp(grad(P(X, Y + 1, Z + 1), xf, yf - 1, zf - 1), grad(P(X + 1, Y + 1, Z + 1), xf - 1, yf - 1, zf - 1), u), v), w);
  };
}

/** Periodic Worley noise: returns distance to the nearest feature point (0..~1), inverted. */
function makeWorley(cells: number, seed: number) {
  const rnd = mulberry32(seed);
  const pts = new Float32Array(cells * cells * cells * 3);
  for (let i = 0; i < pts.length; i++) pts[i] = rnd();
  return (x: number, y: number, z: number) => {
    // x,y,z in [0, cells)
    const cx = Math.floor(x), cy = Math.floor(y), cz = Math.floor(z);
    let best = 1e9;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const ix = ((cx + dx) % cells + cells) % cells, iy = ((cy + dy) % cells + cells) % cells, iz = ((cz + dz) % cells + cells) % cells;
      const k = ((iz * cells + iy) * cells + ix) * 3;
      const px = cx + dx + pts[k], py = cy + dy + pts[k + 1], pz = cz + dz + pts[k + 2];
      const d = (px - x) ** 2 + (py - y) ** 2 + (pz - z) ** 2;
      if (d < best) best = d;
    }
    return 1 - Math.min(1, Math.sqrt(best));
  };
}

export function makeCloudShapeTexture(size = 64): THREE.Data3DTexture {
  const perlin = makePerlin(8, 1), perlin2 = makePerlin(16, 2), perlin3 = makePerlin(32, 3);
  const w1 = makeWorley(4, 11), w2 = makeWorley(8, 12), w3 = makeWorley(16, 13);
  const data = new Uint8Array(size * size * size * 4);
  const remap = (v: number, lo: number, hi: number, nlo: number, nhi: number) => nlo + ((v - lo) / (hi - lo)) * (nhi - nlo);
  let k = 0;
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, s = z / size;
    let p = perlin(u * 8, v * 8, s * 8) * 0.55 + perlin2(u * 16, v * 16, s * 16) * 0.3 + perlin3(u * 32, v * 32, s * 32) * 0.15;
    p = p * 0.5 + 0.5;
    const a = w1(u * 4, v * 4, s * 4), b = w2(u * 8, v * 8, s * 8), c = w3(u * 16, v * 16, s * 16);
    const worleyFbm = a * 0.625 + b * 0.25 + c * 0.125;
    const perlinWorley = remap(p, 0, 1, worleyFbm, 1); // Schneider's perlin-worley
    data[k++] = Math.max(0, Math.min(255, perlinWorley * 255));
    data[k++] = a * 255; data[k++] = b * 255; data[k++] = c * 255;
  }
  const t = new THREE.Data3DTexture(data, size, size, size);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

export function makeCloudDetailTexture(size = 32): THREE.Data3DTexture {
  const w1 = makeWorley(4, 21), w2 = makeWorley(8, 22), w3 = makeWorley(16, 23);
  const data = new Uint8Array(size * size * size * 4);
  let k = 0;
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, s = z / size;
    data[k++] = w1(u * 4, v * 4, s * 4) * 255; data[k++] = w2(u * 8, v * 8, s * 8) * 255; data[k++] = w3(u * 16, v * 16, s * 16) * 255; data[k++] = 255;
  }
  const t = new THREE.Data3DTexture(data, size, size, size);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

export function makeWeatherTexture(size = 256): THREE.DataTexture {
  const p1 = makePerlin(4, 31), p2 = makePerlin(8, 32), p3 = makePerlin(16, 33), p4 = makePerlin(32, 34);
  const data = new Uint8Array(size * size * 4);
  let k = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    let cov = p1(u * 4, v * 4, 0.5) * 0.5 + p2(u * 8, v * 8, 0.5) * 0.25 + p3(u * 16, v * 16, 0.5) * 0.15 + p4(u * 32, v * 32, 0.5) * 0.1;
    cov = cov * 0.5 + 0.5;
    let type = p2(u * 8 + 3.3, v * 8 + 1.1, 0.7) * 0.5 + 0.5;
    data[k++] = cov * 255; data[k++] = type * 255; data[k++] = 0; data[k++] = 255;
  }
  const t = new THREE.DataTexture(data, size, size);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
  return t;
}
