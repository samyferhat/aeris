import * as THREE from 'three';

/**
 * Re-maps the instrument panel's UVs onto the live gauge atlas.
 *
 * The panel arrives from Blender with an automatic unwrap: every dial has its own
 * arbitrary island somewhere in the 0..1 square, which is fine for a baked texture and
 * useless for a canvas laid out as a fixed grid — each dial samples whatever happens to
 * sit under its island, and they all come out black.
 *
 * The dials are separate islands in the mesh, so labelling the connected components of
 * the index buffer finds them exactly. Each component is then given a planar projection
 * into its own cell of the atlas, ordered the way the panel reads: top row left to
 * right, then the next.
 */
export function remapGaugeUVs(mesh: THREE.Mesh, cols = 3, rows = 3, cells = 6): number {
  const geo = mesh.geometry;
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  let uv = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
  const index = geo.getIndex();
  if (!index) return 0;
  if (!uv) {
    uv = new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2);
    geo.setAttribute('uv', uv);
  }

  // --- connected components over shared vertices ---------------------------
  const parent = new Int32Array(pos.count);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (a: number): number => {
    while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
    return a;
  };
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  // Vertices at the same position but with different normals are separate indices;
  // weld them by position so a dial does not split into rings.
  const weld = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${Math.round(pos.getX(i) * 2000)},${Math.round(pos.getY(i) * 2000)},${Math.round(pos.getZ(i) * 2000)}`;
    const seen = weld.get(key);
    if (seen === undefined) weld.set(key, i); else union(seen, i);
  }
  for (let i = 0; i < index.count; i += 3) {
    union(index.getX(i), index.getX(i + 1));
    union(index.getX(i + 1), index.getX(i + 2));
  }

  // --- gather each component's extent --------------------------------------
  interface Island { verts: number[]; min: THREE.Vector2; max: THREE.Vector2 }
  const islands = new Map<number, Island>();
  for (let i = 0; i < pos.count; i++) {
    const root = find(i);
    let is = islands.get(root);
    if (!is) {
      is = { verts: [], min: new THREE.Vector2(Infinity, Infinity), max: new THREE.Vector2(-Infinity, -Infinity) };
      islands.set(root, is);
    }
    is.verts.push(i);
    const x = pos.getX(i), y = pos.getY(i);
    is.min.min(new THREE.Vector2(x, y));
    is.max.max(new THREE.Vector2(x, y));
  }

  // Keep the substantial islands: a dial face, not a stray edge loop.
  const list = [...islands.values()].filter((is) => is.verts.length >= 6);
  if (list.length === 0) return 0;
  // Reading order: rows top to bottom, then left to right within a row. Rows are found
  // by clustering the island centres in y rather than assumed, since panels differ.
  const centres = list.map((is) => new THREE.Vector2((is.min.x + is.max.x) / 2, (is.min.y + is.max.y) / 2));
  const heights = list.map((is) => is.max.y - is.min.y);
  const rowTol = Math.max(0.02, (Math.max(...heights) || 0.05) * 0.6);
  const order = list.map((is, i) => ({ is, c: centres[i], i }));
  order.sort((a, b) => (Math.abs(a.c.y - b.c.y) > rowTol ? b.c.y - a.c.y : a.c.x - b.c.x));

  // --- assign each island its own atlas cell -------------------------------
  const cellW = 1 / cols, cellH = 1 / rows;
  let assigned = 0;
  for (let k = 0; k < order.length; k++) {
    const { is } = order[k];
    // Beyond the dial cells, park the extra islands on an unused corner so they stay
    // dark rather than smearing a gauge across the switch panels.
    const slot = k < cells ? k : -1;
    const cx = slot >= 0 ? (slot % cols) * cellW : 0;
    const cy = slot >= 0 ? Math.floor(slot / cols) * cellH : (rows - 1) * cellH;
    const w = Math.max(is.max.x - is.min.x, 1e-5);
    const h = Math.max(is.max.y - is.min.y, 1e-5);
    // Square the projection on the larger extent so round dials stay round.
    const size = Math.max(w, h);
    const ox = (is.min.x + is.max.x) / 2 - size / 2;
    const oy = (is.min.y + is.max.y) / 2 - size / 2;
    for (const v of is.verts) {
      const u = (pos.getX(v) - ox) / size;
      const vv = (pos.getY(v) - oy) / size;
      // The atlas is authored unflipped, so v runs downward from the cell's top.
      uv.setXY(v, cx + u * cellW, cy + (1 - vv) * cellH);
    }
    if (slot >= 0) assigned++;
  }
  uv.needsUpdate = true;
  return assigned;
}

/**
 * Give a flat panel a planar UV map covering its whole face.
 *
 * The combiner glass comes out of the exporter with an automatic unwrap, so a symbology
 * atlas drawn to fill 0..1 lands on whatever island the unwrapper happened to allocate:
 * a thumbnail in one corner of the glass. A HUD is projected, not painted, and the
 * projection covers the plate, so the right map is a straight planar one taken from the
 * mesh's own bounds in the two axes it spans.
 */
export function planarUV(mesh: THREE.Mesh, uAxis: 'x' | 'y' | 'z' = 'x', vAxis: 'x' | 'y' | 'z' = 'y') {
  const geo = mesh.geometry;
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const uMin = bb.min[uAxis], uSpan = Math.max(1e-6, bb.max[uAxis] - uMin);
  const vMin = bb.min[vAxis], vSpan = Math.max(1e-6, bb.max[vAxis] - vMin);
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const p = { x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) };
    uv[i * 2] = (p[uAxis] - uMin) / uSpan;
    uv[i * 2 + 1] = (p[vAxis] - vMin) / vSpan;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (geo.getAttribute('uv1')) geo.setAttribute('uv1', new THREE.BufferAttribute(uv.slice(), 2));
}
