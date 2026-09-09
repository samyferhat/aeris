/**
 * Droplet-based hydraulic erosion (Hans Beyer's model, as used in most terrain tools).
 *
 * Noise alone gives spiky, self-similar mountains that never read as real. Erosion is
 * what produces the features the eye recognises: V-shaped valleys that join into
 * drainage networks, sharp ridge lines between them, scree slopes, and sediment fans
 * where the water slows down. Running it once at load turns the same fBm into terrain
 * that looks photographed.
 */
export interface ErosionParams {
  droplets: number;
  radius: number;         // erosion brush radius in cells
  inertia: number;        // 0 = follows the slope exactly, 1 = keeps its direction
  capacity: number;       // sediment capacity factor
  minSlope: number;
  deposition: number;
  erode: number;
  evaporation: number;
  gravity: number;
  maxLifetime: number;
  initialSpeed: number;
  initialWater: number;
}

export const DEFAULT_EROSION: ErosionParams = {
  droplets: 260000,
  radius: 4,
  // Inertia is the parameter that decides whether the result looks like terrain.
  // Near zero, every droplet takes the steepest line and they all carve parallel rills:
  // a corduroy hillside. With some momentum they overshoot, meander and merge, which is
  // what produces a branching drainage network and the ridges between its branches.
  inertia: 0.30,
  capacity: 5.5, minSlope: 0.008,
  deposition: 0.30, erode: 0.38, evaporation: 0.017, gravity: 10, maxLifetime: 52,
  initialSpeed: 1, initialWater: 1,
};

/** Precomputed weighted brush so erosion removes material from a disc, not one cell. */
function buildBrush(size: number, radius: number) {
  const offsets: Int32Array[] = [];
  const weights: Float32Array[] = [];
  const ox: number[] = [], oy: number[] = [], w: number[] = [];
  for (let y = -radius; y <= radius; y++) for (let x = -radius; x <= radius; x++) {
    const d2 = x * x + y * y;
    if (d2 < radius * radius) { ox.push(x); oy.push(y); w.push(1 - Math.sqrt(d2) / radius); }
  }
  const total = w.reduce((a, b) => a + b, 0);
  return { ox: Int32Array.from(ox), oy: Int32Array.from(oy), w: Float32Array.from(w.map((v) => v / total)) };
}

/**
 * Erodes `map` (size × size, row-major) in place.
 * `mask(i, j)` returns 0..1 — cells with 0 are left untouched (ocean, runway plateau).
 */
export function hydraulicErosion(map: Float32Array, size: number, cellSize: number, mask: (i: number, j: number) => number, params: Partial<ErosionParams> = {}, seed = 1) {
  const p = { ...DEFAULT_EROSION, ...params };
  const brush = buildBrush(size, p.radius);
  let rngState = seed >>> 0;
  const rnd = () => {
    rngState = (rngState + 0x6d2b79f5) | 0;
    let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Height and gradient with bilinear interpolation of the four surrounding cells.
  const gradAndHeight = (x: number, y: number) => {
    const i = x | 0, j = y | 0;
    const u = x - i, v = y - j;
    const k = j * size + i;
    const h00 = map[k], h10 = map[k + 1], h01 = map[k + size], h11 = map[k + size + 1];
    const gx = (h10 - h00) * (1 - v) + (h11 - h01) * v;
    const gy = (h01 - h00) * (1 - u) + (h11 - h10) * u;
    const h = h00 * (1 - u) * (1 - v) + h10 * u * (1 - v) + h01 * (1 - u) * v + h11 * u * v;
    return { gx: gx / cellSize, gy: gy / cellSize, h };
  };

  for (let d = 0; d < p.droplets; d++) {
    let x = rnd() * (size - 2) + 0.5, y = rnd() * (size - 2) + 0.5;
    // Only start droplets on land worth eroding.
    if (mask(x | 0, y | 0) < 0.35) continue;
    let dx = 0, dy = 0;
    let speed = p.initialSpeed, water = p.initialWater, sediment = 0;

    for (let life = 0; life < p.maxLifetime; life++) {
      const nodeX = x | 0, nodeY = y | 0;
      const cellOffX = x - nodeX, cellOffY = y - nodeY;
      const g = gradAndHeight(x, y);
      // New direction: blend of momentum and downhill gradient.
      dx = dx * p.inertia - g.gx * (1 - p.inertia);
      dy = dy * p.inertia - g.gy * (1 - p.inertia);
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) break;
      dx /= len; dy /= len;
      const nx = x + dx, ny = y + dy;
      if (nx < 1 || nx >= size - 2 || ny < 1 || ny >= size - 2) break;
      const newH = gradAndHeight(nx, ny).h;
      const dh = newH - g.h;

      // Sediment the droplet can carry: more when fast, deep and going steeply downhill.
      const capacity = Math.max(-dh, p.minSlope) * speed * water * p.capacity;

      if (dh > 0 || sediment > capacity) {
        // Uphill or oversaturated: drop sediment (fills pits, builds fans).
        const amount = dh > 0 ? Math.min(dh, sediment) : (sediment - capacity) * p.deposition;
        sediment -= amount;
        const k = nodeY * size + nodeX;
        map[k] += amount * (1 - cellOffX) * (1 - cellOffY) * mask(nodeX, nodeY);
        map[k + 1] += amount * cellOffX * (1 - cellOffY) * mask(nodeX + 1, nodeY);
        map[k + size] += amount * (1 - cellOffX) * cellOffY * mask(nodeX, nodeY + 1);
        map[k + size + 1] += amount * cellOffX * cellOffY * mask(nodeX + 1, nodeY + 1);
      } else {
        // Downhill and thirsty: carve, spread over the brush so valleys are smooth.
        const amount = Math.min((capacity - sediment) * p.erode, -dh);
        for (let b = 0; b < brush.w.length; b++) {
          const bx = nodeX + brush.ox[b], by = nodeY + brush.oy[b];
          if (bx < 0 || by < 0 || bx >= size || by >= size) continue;
          const m = mask(bx, by);
          if (m <= 0) continue;
          const take = amount * brush.w[b] * m;
          map[by * size + bx] -= take;
          sediment += take;
        }
      }
      speed = Math.sqrt(Math.max(0, speed * speed + -dh * p.gravity));
      water *= 1 - p.evaporation;
      if (water < 0.01) break;
      x = nx; y = ny;
    }
  }
}

/** Small box blur, used to soften the erosion result slightly. */
export function smooth(map: Float32Array, size: number, amount: number, mask: (i: number, j: number) => number) {
  const src = map.slice();
  for (let j = 1; j < size - 1; j++) for (let i = 1; i < size - 1; i++) {
    const k = j * size + i;
    const m = mask(i, j) * amount;
    if (m <= 0) continue;
    const avg = (src[k] * 4 + src[k - 1] + src[k + 1] + src[k - size] + src[k + size]) / 8;
    map[k] = src[k] * (1 - m) + avg * m;
  }
}
