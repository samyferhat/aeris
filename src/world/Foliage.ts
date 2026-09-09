import * as THREE from 'three';
import { mulberry32 } from '../core/Noise';

/**
 * Procedural leaf-cluster atlas.
 *
 * A photo-real canopy at flight altitude is mostly about silhouette and colour
 * variation, so instead of shipping a photo cut-out we draw a few hundred individual
 * leaves per cluster on a canvas: varied hue, size, orientation and translucency, with
 * a soft alpha edge. A matching normal map is derived from the drawn coverage so the
 * cards catch the sun instead of reading as flat stickers.
 */
export function makeLeafCluster(seed = 5, size = 512): { map: THREE.CanvasTexture; normal: THREE.CanvasTexture } {
  const rnd = mulberry32(seed);
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, size, size);

  const leaf = (x: number, y: number, len: number, wid: number, rot: number, fill: string) => {
    g.save(); g.translate(x, y); g.rotate(rot); g.fillStyle = fill;
    g.beginPath();
    g.moveTo(0, -len * 0.5);
    g.quadraticCurveTo(wid * 0.5, 0, 0, len * 0.5);
    g.quadraticCurveTo(-wid * 0.5, 0, 0, -len * 0.5);
    g.fill(); g.restore();
  };

  // Two canopy lobes so the card silhouette is not a single blob.
  const clusters = [
    { cx: size * 0.5, cy: size * 0.42, r: size * 0.36, n: 420 },
    { cx: size * 0.5, cy: size * 0.72, r: size * 0.26, n: 240 },
  ];
  for (const cl of clusters) {
    for (let i = 0; i < cl.n; i++) {
      // Denser toward the middle, sparse and ragged at the rim.
      const a = rnd() * Math.PI * 2;
      const r = cl.r * Math.pow(rnd(), 0.55);
      const x = cl.cx + Math.cos(a) * r, y = cl.cy + Math.sin(a) * r * 0.92;
      const depth = 1 - r / cl.r;                       // 1 = centre (shaded), 0 = rim (lit)
      const hue = 88 + rnd() * 26 - depth * 8;
      const sat = 32 + rnd() * 26;
      const light = 14 + rnd() * 20 + (1 - depth) * 16;
      const alpha = 0.75 + rnd() * 0.25;
      leaf(x, y, size * (0.045 + rnd() * 0.045), size * (0.016 + rnd() * 0.02), rnd() * Math.PI * 2,
        `hsla(${hue}, ${sat}%, ${light}%, ${alpha})`);
    }
  }
  // A few twigs poking out of the silhouette.
  g.strokeStyle = 'rgba(48, 38, 26, 0.85)'; g.lineWidth = size * 0.006;
  for (let i = 0; i < 22; i++) {
    const a = -Math.PI / 2 + (rnd() - 0.5) * 2.4;
    const r0 = size * 0.1, r1 = size * (0.24 + rnd() * 0.16);
    g.beginPath();
    g.moveTo(size * 0.5 + Math.cos(a) * r0, size * 0.78 + Math.sin(a) * r0);
    g.lineTo(size * 0.5 + Math.cos(a) * r1, size * 0.78 + Math.sin(a) * r1);
    g.stroke();
  }

  // --- normal map from the alpha coverage (blurred to act as a canopy relief)
  const img = g.getImageData(0, 0, size, size);
  const h = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) h[i] = img.data[i * 4 + 3] / 255;
  // separable blur
  const tmp = new Float32Array(size * size);
  const R = 3;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let s = 0, n = 0;
    for (let k = -R; k <= R; k++) { const xx = x + k; if (xx < 0 || xx >= size) continue; s += h[y * size + xx]; n++; }
    tmp[y * size + x] = s / n;
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let s = 0, n = 0;
    for (let k = -R; k <= R; k++) { const yy = y + k; if (yy < 0 || yy >= size) continue; s += tmp[yy * size + x]; n++; }
    h[y * size + x] = s / n;
  }
  const nc = document.createElement('canvas'); nc.width = nc.height = size;
  const ng = nc.getContext('2d')!;
  const nimg = ng.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const l = h[y * size + Math.max(0, x - 1)], r = h[y * size + Math.min(size - 1, x + 1)];
    const d = h[Math.max(0, y - 1) * size + x], u = h[Math.min(size - 1, y + 1) * size + x];
    const nx = (l - r) * 3.0, ny = (d - u) * 3.0, nz = 1;
    const len = Math.hypot(nx, ny, nz);
    nimg.data[i * 4] = ((nx / len) * 0.5 + 0.5) * 255;
    nimg.data[i * 4 + 1] = ((ny / len) * 0.5 + 0.5) * 255;
    nimg.data[i * 4 + 2] = ((nz / len) * 0.5 + 0.5) * 255;
    nimg.data[i * 4 + 3] = 255;
  }
  ng.putImageData(nimg, 0, 0);

  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8; map.minFilter = THREE.LinearMipmapLinearFilter; map.generateMipmaps = true;
  const normal = new THREE.CanvasTexture(nc);
  normal.anisotropy = 4; normal.minFilter = THREE.LinearMipmapLinearFilter; normal.generateMipmaps = true;
  return { map, normal };
}

/** Simple bark texture (vertical fibres + cracks), used on the instanced trunks. */
export function makeBark(seed = 9, size = 256): { map: THREE.CanvasTexture } {
  const rnd = mulberry32(seed);
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#4a3b2c'; g.fillRect(0, 0, size, size);
  for (let i = 0; i < 900; i++) {
    const x = rnd() * size, w = 1 + rnd() * 4, hgt = size * (0.2 + rnd() * 0.8);
    const y = rnd() * size;
    const v = 24 + rnd() * 46;
    g.fillStyle = `rgba(${v}, ${v * 0.8}, ${v * 0.6}, ${0.25 + rnd() * 0.5})`;
    g.fillRect(x, y, w, hgt);
  }
  for (let i = 0; i < 60; i++) {
    g.strokeStyle = `rgba(18, 13, 9, ${0.3 + rnd() * 0.5})`;
    g.lineWidth = 1 + rnd() * 2;
    const x = rnd() * size; g.beginPath(); g.moveTo(x, 0);
    for (let y = 0; y < size; y += 16) g.lineTo(x + (rnd() - 0.5) * 8, y);
    g.stroke();
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.minFilter = THREE.LinearMipmapLinearFilter; map.generateMipmaps = true;
  return { map };
}
