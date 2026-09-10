/**
 * Top-down map of the archipelago, straight from the generator, written to docs/map.png.
 *
 *   node tools/mapview.mjs [resolution]
 *
 * Designing a coastline by editing numbers and then flying out to look at it costs a
 * minute a try. This costs two seconds, so the layout gets iterated on properly.
 * Vite loads the module so the TypeScript and the extensionless imports resolve exactly
 * as they do in the game — the map is drawn by the same code that builds the world.
 */
import { createServer } from "vite";
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const RES = Number(process.argv[2] ?? 900);
/** Optional window: centre x, centre z, span in metres. Defaults to the whole world. */
const CX = Number(process.argv[3] ?? 0), CZ = Number(process.argv[4] ?? 0);

const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'error' });
const A = await server.ssrLoadModule('/src/world/Archipelago.ts');
const { SimplexNoise } = await server.ssrLoadModule('/src/core/Noise.ts');

const n = new SimplexNoise(20260910);
const SPAN = Number(process.argv[5] ?? A.WORLD_SIZE);
const half = SPAN / 2;
const h = new Float32Array(RES * RES);
const tmpP = [0, 0], tmpC = [0, 0], tmpS = A.newSample();
let t0 = Date.now();
for (let j = 0; j < RES; j++) {
  const z = CZ - half + (j / (RES - 1)) * SPAN;
  for (let i = 0; i < RES; i++) {
    const x = CX - half + (i / (RES - 1)) * SPAN;
    h[j * RES + i] = A.elevationAt(x, z, n, tmpP, tmpC, tmpS);
  }
}
const genMs = Date.now() - t0;

// ---- hypsometric tint -----------------------------------------------------
const px = new Uint8Array(RES * RES * 4);
const stops = [
  [-400, 4, 18, 52], [-120, 8, 44, 96], [-40, 16, 96, 150], [-12, 34, 156, 178],
  [-4, 86, 205, 196], [-0.5, 176, 226, 205], [0, 232, 218, 176], [6, 196, 200, 140],
  [60, 120, 160, 92], [220, 92, 138, 74], [480, 138, 128, 96], [760, 176, 168, 152],
  [1100, 246, 246, 250],
];
const tint = (v) => {
  for (let k = 1; k < stops.length; k++) {
    if (v <= stops[k][0] || k === stops.length - 1) {
      const a = stops[k - 1], b = stops[k];
      const t = Math.max(0, Math.min(1, (v - a[0]) / (b[0] - a[0])));
      return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
    }
  }
  return [255, 255, 255];
};
const cell = SPAN / (RES - 1);
for (let j = 0; j < RES; j++) for (let i = 0; i < RES; i++) {
  const k = j * RES + i, v = h[k];
  let [r, g, b] = tint(v);
  // Relief shading from the north-west, so ridges and valleys read.
  const l = h[j * RES + Math.max(0, i - 1)], rr = h[j * RES + Math.min(RES - 1, i + 1)];
  const u = h[Math.max(0, j - 1) * RES + i], d = h[Math.min(RES - 1, j + 1) * RES + i];
  const nx = (l - rr) / (2 * cell), nz = (u - d) / (2 * cell);
  const shade = v > 0 ? Math.max(0.35, Math.min(1.5, 1 + (nx * 0.62 + nz * 0.62) * 3.2)) : 1;
  const o = k * 4;
  px[o] = Math.min(255, r * shade); px[o + 1] = Math.min(255, g * shade); px[o + 2] = Math.min(255, b * shade);
  px[o + 3] = 255;
}
// Coastline and the 0 m / -5 m contours as thin dark lines.
for (let j = 1; j < RES - 1; j++) for (let i = 1; i < RES - 1; i++) {
  const k = j * RES + i;
  const s = (v) => (v > 0 ? 1 : 0);
  if (s(h[k]) !== s(h[k + 1]) || s(h[k]) !== s(h[k + RES])) {
    const o = k * 4; px[o] = 20; px[o + 1] = 24; px[o + 2] = 30;
  }
}

// 2 km grid, so a coordinate can be read straight off the picture.
const GRID = SPAN > 8000 ? 2000 : SPAN > 3000 ? 500 : 100;
for (let g = Math.ceil((CX - half) / GRID) * GRID; g <= CX + half; g += GRID) {
  const gi = Math.round((g - CX + half) / SPAN * (RES - 1));
  const gj = Math.round((g - CZ + half) / SPAN * (RES - 1));
  const strong = Math.abs(g) < 1;
  for (let k = 0; k < RES; k++) {
    for (const [i2, j2] of [[gi, k], [k, gj]]) {
      if (i2 < 0 || i2 >= RES) continue;
      const o = (j2 * RES + i2) * 4;
      const a = strong ? 0.5 : 0.16;
    if (j2 < 0 || j2 >= RES) continue;
      px[o] = px[o] * (1 - a) + 255 * a; px[o + 1] = px[o + 1] * (1 - a) + 255 * a; px[o + 2] = px[o + 2] * (1 - a) + 255 * a;
    }
  }
}

// ---- markers --------------------------------------------------------------
const toPx = (x, z) => [Math.round((x - CX + half) / SPAN * (RES - 1)), Math.round((z - CZ + half) / SPAN * (RES - 1))];
const dot = (x, z, col, rad = 3) => {
  const [i0, j0] = toPx(x, z);
  for (let j = -rad; j <= rad; j++) for (let i = -rad; i <= rad; i++) {
    if (i * i + j * j > rad * rad) continue;
    const i2 = i0 + i, j2 = j0 + j;
    if (i2 < 0 || j2 < 0 || i2 >= RES || j2 >= RES) continue;
    const o = (j2 * RES + i2) * 4; px[o] = col[0]; px[o + 1] = col[1]; px[o + 2] = col[2];
  }
};
const line = (x0, z0, x1, z1, col) => {
  const steps = 400;
  for (let s = 0; s <= steps; s++) dot(x0 + (x1 - x0) * s / steps, z0 + (z1 - z0) * s / steps, col, 1);
};
for (const af of A.AIRFIELDS) {
  const a = (af.heading - 90) * Math.PI / 180;
  line(af.x - Math.cos(a) * af.length / 2, af.z - Math.sin(a) * af.length / 2,
       af.x + Math.cos(a) * af.length / 2, af.z + Math.sin(a) * af.length / 2, [255, 60, 60]);
}
dot(A.PORT.x, A.PORT.z, [255, 200, 40], 5);
for (const v of A.VILLAGES) dot(v.x, v.z, [255, 150, 40], 4);
dot(A.LIGHTHOUSE.x, A.LIGHTHOUSE.z, [255, 255, 255], 4);
dot(A.WRECK.x, A.WRECK.z, [40, 40, 40], 4);
{
  const s = A.STRAIT, bx = s.a[0] + (s.b[0] - s.a[0]) * s.at, bz = s.a[1] + (s.b[1] - s.a[1]) * s.at;
  const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1], L = Math.hypot(dx, dz);
  line(bx - dz / L * s.span / 2, bz + dx / L * s.span / 2, bx + dz / L * s.span / 2, bz - dx / L * s.span / 2, [230, 60, 200]);
}

// ---- PNG ------------------------------------------------------------------
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n2 = 0; n2 < 256; n2++) { let c = n2; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n2] = c >>> 0; }
  return t;
})();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
const raw = Buffer.alloc(RES * (RES * 4 + 1));
for (let j = 0; j < RES; j++) {
  raw[j * (RES * 4 + 1)] = 0;
  Buffer.from(px.buffer, j * RES * 4, RES * 4).copy(raw, j * (RES * 4 + 1) + 1);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(RES, 0); ihdr.writeUInt32BE(RES, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0)),
]);
mkdirSync('docs', { recursive: true });
writeFileSync('docs/map.png', png);

// ---- report ---------------------------------------------------------------
let land = 0, maxH = -1e9, shallow = 0;
for (const v of h) { if (v > 0) land++; if (v > maxH) maxH = v; if (v < 0 && v > -12) shallow++; }
console.log(JSON.stringify({
  world: A.WORLD_SIZE, res: RES, genMs,
  landPct: +(100 * land / h.length).toFixed(1),
  shallowPct: +(100 * shallow / h.length).toFixed(1),
  maxHeight: Math.round(maxH),
  peaks: A.ISLANDS.map((s) => s.id + ':' + Math.round(s.peakH)),
}));
await server.close();
