import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Heightfield } from './Heightfield';
import { WORLD_SIZE, PORT, VILLAGES, AIRFIELDS, STRAIT, LIGHTHOUSE, WRECK } from './Archipelago';
import { applyAerialPerspective } from '../sky/AerialPerspective';
import { mulberry32, SimplexNoise, smoothstep, clamp, lerp } from '../core/Noise';

/**
 * Where people live, and what that does to the ground.
 *
 * A town on a hillside is not buildings scattered on a slope: it is streets that follow
 * the contours because a street cannot climb faster than a lorry can, plots cut flat
 * into the hill because a house cannot be built on a slope, and a density that falls off
 * from the water because that is where the work was. All three are generated here, in
 * that order, and the third one is what makes it legible from the air.
 *
 * The heightfield is carved before the terrain is meshed, so the terraces are in the
 * ground itself rather than being hidden under the buildings — which is the difference
 * between a town on a hill and a town hovering over one.
 */

/** Footprint and role of each archetype exported from blender/town/build.py. */
interface Arch { w: number; d: number; cat: 'old' | 'house' | 'block' | 'civic' | 'works' | 'boat' | 'special'; h?: number }
const ARCH: Record<string, Arch> = {
  Town_A: { w: 6.2, d: 9.0, cat: 'old', h: 11.4 },
  Town_B: { w: 7.4, d: 10.5, cat: 'old', h: 15.1 },
  Town_C: { w: 8.6, d: 7.4, cat: 'old', h: 9.1 },
  Town_D: { w: 12.0, d: 11.5, cat: 'old', h: 11.8 },
  House_A: { w: 9.0, d: 7.2, cat: 'house', h: 5.5 },
  House_B: { w: 11.0, d: 8.0, cat: 'house', h: 8.9 },
  Villa: { w: 14.0, d: 13.5, cat: 'house', h: 9.0 },
  Farm: { w: 22.0, d: 16.0, cat: 'house', h: 8.4 },
  Block_A: { w: 22.0, d: 12.0, cat: 'block', h: 16.1 },
  Block_B: { w: 30.0, d: 14.0, cat: 'block', h: 24.4 },
  Block_C: { w: 16.0, d: 11.0, cat: 'block', h: 9.2 },
  Terrace: { w: 32.0, d: 8.4, cat: 'block', h: 11.0 },
  Church: { w: 11.0, d: 40.0, cat: 'civic', h: 35.2 },
  School: { w: 34.0, d: 14.0, cat: 'civic', h: 7.9 },
  Shop: { w: 10.0, d: 8.0, cat: 'old', h: 8.8 },
  Warehouse: { w: 40.0, d: 20.0, cat: 'works', h: 11.1 },
  Shed: { w: 18.0, d: 10.0, cat: 'works', h: 6.7 },
  Silo: { w: 13.0, d: 6.0, cat: 'works', h: 15.2 },
  WaterTower: { w: 7.5, d: 7.5, cat: 'works', h: 21.0 },
  Crane: { w: 11.0, d: 40.0, cat: 'works', h: 25.2 },
  QuayShed: { w: 26.0, d: 13.0, cat: 'works', h: 8.8 },
  BoatFishing: { w: 3.8, d: 12.0, cat: 'boat' },
  CargoShip: { w: 13.0, d: 78.0, cat: 'boat' },
  Skiff: { w: 2.1, d: 6.4, cat: 'boat' },
  Lighthouse: { w: 10.4, d: 14.0, cat: 'special', h: 26.6 },
  BridgeTower: { w: 28.0, d: 6.0, cat: 'special', h: 100.2 },
  BridgeDeck: { w: 18.4, d: 20.0, cat: 'special', h: 1.4 },
  Car: { w: 1.8, d: 4.3, cat: 'boat' },
  Van: { w: 2.1, d: 5.7, cat: 'boat' },
  Lamp: { w: 1.0, d: 2.6, cat: 'special' },
  Pier: { w: 4.6, d: 20.0, cat: 'special', h: 2.6 },
  Breakwater: { w: 11.0, d: 12.0, cat: 'special', h: 2.6 },
  Buoy: { w: 1.3, d: 1.3, cat: 'boat' },
  Wreck: { w: 11.0, d: 54.0, cat: 'boat' },
  TunnelPortal: { w: 15.0, d: 2.2, cat: 'special', h: 9.1 },
};

export interface Placement {
  type: string;
  x: number; z: number; y: number;
  /** Rotation about Y. 0 puts the archetype's front (its -Y face in Blender) towards +Z. */
  rot: number;
  scale: number;
  /** Wall colour for this instance, and the seed its window lights are drawn from. */
  tint: THREE.Color;
  seed: number;
}

/** A street: a polyline on the ground, with a width. */
export interface Street { pts: THREE.Vector2[]; width: number; kind: 'main' | 'lane' | 'coast' }

const WALL_PALETTE = [
  0xe6ddc9, 0xe9d9bc, 0xdfd3c0, 0xf0e6d2, 0xd8cbb4, 0xe5cfa8, 0xdcd6cc,
  0xd0c4ae, 0xe8dcc6, 0xcfc0a4, 0xf2ead9, 0xdac9b6, 0xe0c9a8, 0xcdd0c6,
];

export class Settlement extends THREE.Group {
  readonly placements: Placement[] = [];
  readonly streets: Street[] = [];
  /** Built-up coverage, world-mapped: r = buildings, g = roads/hard standing, b = height. */
  readonly townMap: THREE.DataTexture;
  private mapData: Uint8Array;
  private static MAP = 1024;
  private rnd = mulberry32(0x5eed1a);
  private noise = new SimplexNoise(4242);
  private meshes: THREE.InstancedMesh[] = [];
  private uCull = { value: 3400 };
  private uNight = { value: 0 };
  readonly clearings: { x: number; z: number; r: number }[] = [];
  /** Where the quays are, so the boats can be moored along them. */
  readonly moorings: { x: number; z: number; rot: number }[] = [];
  /** Where the port actually ended up once the ground had been consulted. */
  portSite = { x: PORT.x, z: PORT.z };
  readonly villageSites: { x: number; z: number }[] = [];
  /**
   * Occupancy, on a coarse grid. Contour streets converge where the slope steepens, and
   * without this the buildings on two neighbouring terraces end up inside one another.
   */
  private occ = new Map<number, { x: number; z: number; r: number }[]>();

  constructor(private hf: Heightfield) {
    super();
    const M = Settlement.MAP;
    this.mapData = new Uint8Array(M * M * 4);
    this.townMap = new THREE.DataTexture(this.mapData, M, M);
    this.townMap.wrapS = this.townMap.wrapT = THREE.ClampToEdgeWrapping;
    this.townMap.minFilter = THREE.LinearMipmapLinearFilter;
    this.townMap.magFilter = THREE.LinearFilter;
    this.townMap.generateMipmaps = true;
    this.frustumCulled = false;
  }

  // ==========================================================================
  // Planning
  // ==========================================================================

  /** Lays out every settlement and carves the ground. Call before meshing the terrain. */
  plan() {
    this.planPort();
    for (const v of VILLAGES) {
      const site = this.snapToShore(v.x, v.z, 900);
      this.villageSites.push(site);
      this.planVillage(site.x, site.z, v.r);
    }
    this.planScattered();
    this.planSpecials();
    this.planRoads();
    this.planHarbour();
    this.planStreetLights();
    this.carve();
    // The strips get the last word on the ground they stand on.
    this.hf.carveAirfields();
    this.buildRoads();
    this.rasterise();
  }

  /**
   * The harbour: a breakwater across the mouth, piers off the quay, buoys marking the
   * fairway, and the freighter that never made it.
   */
  private planHarbour() {
    const P = this.portSite;
    if (this.moorings.length > 2) {
      // Piers, off the quay and out into the water.
      for (let i = 1; i < this.moorings.length; i += 3) {
        const m = this.moorings[i];
        this.place('Pier', m.x, m.z, m.rot + Math.PI / 2, 1, 0);
      }
      // Breakwater: a mole running on from the last mooring, out across the swell,
      // stopping where the water gets too deep to build in.
      const a = this.moorings[Math.max(0, this.moorings.length - 3)];
      const b = this.moorings[this.moorings.length - 1];
      const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
      const ux2 = dx / L, uz2 = dz / L;
      for (let i = 0; i < 22; i++) {
        const t = 30 + i * 11.5;
        const x = b.x + ux2 * t, z = b.z + uz2 * t;
        const h = this.hf.getHeight(x, z);
        if (h > 0.5 || h < -17) break;
        this.place('Breakwater', x, z, Math.atan2(uz2, ux2) + Math.PI / 2, 1, 0);
      }
    }
    for (let i = 0; i < 9; i++) {
      const a = this.rnd() * Math.PI * 2, r = 260 + this.rnd() * 1500;
      const x = P.x + Math.cos(a) * r, z = P.z + Math.sin(a) * r;
      const d = this.hf.getHeight(x, z);
      if (d > -4 || d < -40) continue;
      this.place('Buoy', x, z, 0, 1, 0);
    }
    this.place('Wreck', WRECK.x, WRECK.z, WRECK.heading, 1, Math.max(-2.4, this.hf.getHeight(WRECK.x, WRECK.z) + 2.2));
  }

  /** Lamp posts down the streets of anywhere that has streets. */
  private planStreetLights() {
    const towns = [this.portSite, ...this.villageSites];
    for (const st of this.streets) {
      if (st.kind === 'lane') continue;
      let acc = 0;
      for (let i = 1; i < st.pts.length; i++) {
        const a = st.pts[i - 1], b = st.pts[i];
        const seg = a.distanceTo(b);
        acc += seg;
        if (acc < 38) continue;
        acc = 0;
        const near = towns.some((t) => Math.hypot(a.x - t.x, a.y - t.z) < (t === this.portSite ? 2200 : 700));
        if (!near) continue;
        const dx = (b.x - a.x) / seg, dz = (b.y - a.y) / seg;
        const side = (i >> 1) % 2 ? 1 : -1;
        const off = st.width / 2 + 0.9;
        const x = a.x - dz * side * off, z = a.y + dx * side * off;
        this.place('Lamp', x, z, Math.atan2(dz * side, -dx * side), 1, this.hf.getHeight(x, z));
      }
    }
  }

  // ---- roads ---------------------------------------------------------------

  /**
   * Routes a road between two places.
   *
   * A road is not a straight line and it is not a contour either: it is the cheapest
   * compromise between the two. At each pace the router looks at a fan of headings and
   * takes the one that gets closest to the destination for the least climb, which is
   * how a real corniche ends up hugging the coast and swinging inland round a gully.
   */
  private routeRoad(ax: number, az: number, bx: number, bz: number, step = 34): THREE.Vector2[] {
    const pts = [new THREE.Vector2(ax, az)];
    let x = ax, z = az;
    let hdg = Math.atan2(bz - az, bx - ax);
    for (let i = 0; i < 900; i++) {
      const rem = Math.hypot(bx - x, bz - z);
      if (rem < step * 1.5) break;
      const want = Math.atan2(bz - z, bx - x);
      const h0 = this.hf.getHeight(x, z);
      let bestA = hdg, bestC = Infinity;
      for (let k = -4; k <= 4; k++) {
        const a = hdg + k * 0.20;
        // Never double back: a road that reverses has found a wall, not a route.
        let da = a - want; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
        if (Math.abs(da) > 1.35) continue;
        const nx = x + Math.cos(a) * step, nz = z + Math.sin(a) * step;
        const h1 = this.hf.getHeight(nx, nz);
        if (h1 < 1.2) continue;                       // roads do not go into the sea
        const grade = Math.abs(h1 - h0) / step;
        const cost = Math.hypot(bx - nx, bz - nz) + grade * 2600 + Math.abs(da) * 60;
        if (cost < bestC) { bestC = cost; bestA = a; }
      }
      if (!isFinite(bestC)) break;
      hdg = bestA;
      x += Math.cos(hdg) * step; z += Math.sin(hdg) * step;
      pts.push(new THREE.Vector2(x, z));
    }
    pts.push(new THREE.Vector2(bx, bz));
    return pts;
  }

  /** The corniche round the main island, and the links between the places on it. */
  private planRoads() {
    const p = this.portSite;
    const [ux, uz] = this.inland(p.x, p.z);
    // A coast road at forty metres: high enough to be a corniche, low enough to be one.
    let sx = p.x, sz = p.z;
    for (let t = 0; t < 1800; t += 10) {
      const px = p.x + ux * t, pz = p.z + uz * t;
      if (this.hf.getHeight(px, pz) >= 42) { sx = px; sz = pz; break; }
    }
    this.streetAt(sx, sz, 42, 30000, 8, 'coast', (x, z) => {
      const h = this.hf.getHeight(x, z);
      return h > 6 && h < 420 && this.hf.getSlope(x, z) < 0.62;
    });
    // Links: the airfield, the villages, and the bridge.
    const S = STRAIT, sa = S.a, sb = S.b ?? S.a;
    const bx = sa[0] + (sb[0] - sa[0]) * S.at, bz = sa[1] + (sb[1] - sa[1]) * S.at;
    const dx = sb[0] - sa[0], dz = sb[1] - sa[1], L = Math.hypot(dx, dz);
    const nx = -dz / L, nz = dx / L;
    // To the apron, not to the middle of the runway.
    const af0 = AIRFIELDS[0];
    const a0 = (af0.heading - 90) * Math.PI / 180;
    const apx = af0.x + (af0.apron ? af0.apron.dx : 0) * Math.cos(a0) - (af0.apron ? af0.apron.dz : 0) * Math.sin(a0);
    const apz = af0.z + (af0.apron ? af0.apron.dx : 0) * Math.sin(a0) + (af0.apron ? af0.apron.dz : 0) * Math.cos(a0);
    const ends: [number, number][] = [
      [apx, apz + 120],
      [bx + nx * (S.halfWidth + 260), bz + nz * (S.halfWidth + 260)],
    ];
    for (const v of this.villageSites) if (Math.hypot(v.x - p.x, v.z - p.z) < 9000) ends.push([v.x, v.z]);
    for (const e of ends) {
      const pts = this.routeRoad(p.x, p.z, e[0], e[1]);
      if (pts.length > 4) this.streets.push({ pts, width: 7.5, kind: 'coast' });
    }
  }

  /**
   * Turns the street polylines into one ribbon mesh. Roads are what make a town legible
   * from the air — the buildings only say where it is, the streets say what shape it is.
   */
  private buildRoads() {
    let n = 0;
    for (const st of this.streets) n += st.pts.length;
    const pos = new Float32Array(n * 2 * 3), nor = new Float32Array(n * 2 * 3), uv = new Float32Array(n * 2 * 2);
    const idx: number[] = [];
    let v = 0;
    for (const st of this.streets) {
      const pts = st.pts;
      let arc = 0;
      const start = v;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        let dx = b.x - a.x, dz = b.y - a.y;
        const l = Math.hypot(dx, dz) || 1;
        dx /= l; dz /= l;
        if (i > 0) arc += pts[i].distanceTo(pts[i - 1]);
        const hw = st.width / 2;
        for (const side of [-1, 1] as const) {
          const x = pts[i].x - dz * side * hw, z = pts[i].y + dx * side * hw;
          pos[v * 3] = x; pos[v * 3 + 1] = this.hf.getHeight(x, z) + 0.16; pos[v * 3 + 2] = z;
          nor[v * 3] = 0; nor[v * 3 + 1] = 1; nor[v * 3 + 2] = 0;
          uv[v * 2] = arc / 12; uv[v * 2 + 1] = side * 0.5 + 0.5;
          v++;
        }
        if (i > 0) {
          const k = start + (i - 1) * 2;
          idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({ color: 0x2a2a2b, roughness: 0.92, metalness: 0 });
    (mat as any)._apKey = 'road';
    applyAerialPerspective(mat, (sh) => {
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vRoadUv;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          // Kerbs at the edges and a broken centre line: two cheap details that turn a
          // dark ribbon into a road as soon as you are below a thousand feet.
          float edge = smoothstep(0.40, 0.50, abs(vRoadUv.y - 0.5));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.30, 0.29, 0.27), edge * 0.75);
          float line = step(abs(vRoadUv.y - 0.5), 0.035) * step(0.45, fract(vRoadUv.x));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.53, 0.46), line * 0.8);`);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vRoadUv;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvRoadUv = uv;');
    });
    this.roadMat = mat;
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.add(mesh);
  }

  private roadMat: THREE.MeshStandardMaterial | null = null;

  // ---- streets -------------------------------------------------------------

  /**
   * Follows a line of constant altitude across the terrain.
   *
   * A hill town's streets are contours, because a cart cannot climb a one-in-three.
   * Marching perpendicular to the gradient walks along one; a couple of Newton steps
   * back onto the target height at each pace keeps it from drifting off.
   */
  private traceContour(x0: number, z0: number, targetH: number, step: number, maxPts: number,
                       inside: (x: number, z: number) => boolean, dir = 1): THREE.Vector2[] {
    const pts: THREE.Vector2[] = [];
    let x = x0, z = z0;
    const e = 6;
    for (let i = 0; i < maxPts; i++) {
      // Gradient, uphill.
      let gx = (this.hf.getHeight(x + e, z) - this.hf.getHeight(x - e, z)) / (2 * e);
      let gz = (this.hf.getHeight(x, z + e) - this.hf.getHeight(x, z - e)) / (2 * e);
      let g2 = gx * gx + gz * gz;
      if (g2 < 1e-8) break;
      // Step along the contour.
      const gl = Math.sqrt(g2);
      x += (-gz / gl) * step * dir;
      z += (gx / gl) * step * dir;
      // Correct back onto it.
      for (let k = 0; k < 3; k++) {
        const h = this.hf.getHeight(x, z);
        gx = (this.hf.getHeight(x + e, z) - this.hf.getHeight(x - e, z)) / (2 * e);
        gz = (this.hf.getHeight(x, z + e) - this.hf.getHeight(x, z - e)) / (2 * e);
        g2 = gx * gx + gz * gz;
        if (g2 < 1e-8) break;
        const c = (h - targetH) / g2;
        x -= gx * c; z -= gz * c;
      }
      if (!inside(x, z)) break;
      if (Math.abs(this.hf.getHeight(x, z) - targetH) > step) break;
      pts.push(new THREE.Vector2(x, z));
    }
    return pts;
  }

  private streetAt(x0: number, z0: number, h: number, len: number, width: number,
                   kind: Street['kind'], inside: (x: number, z: number) => boolean) {
    const step = 14;
    const a = this.traceContour(x0, z0, h, step, Math.round(len / step), inside, -1).reverse();
    const b = this.traceContour(x0, z0, h, step, Math.round(len / step), inside, 1);
    const pts = [...a, new THREE.Vector2(x0, z0), ...b];
    if (pts.length < 6) return null;
    const s: Street = { pts, width, kind };
    this.streets.push(s);
    return s;
  }

  // ---- the port city -------------------------------------------------------

  /**
   * The uphill direction here, averaged over a couple of hundred metres so that one
   * gully does not decide which way "inland" is.
   */
  private inland(x: number, z: number): [number, number] {
    let gx = 0, gz = 0;
    for (const e of [60, 140, 260]) {
      gx += this.hf.getHeight(x + e, z) - this.hf.getHeight(x - e, z);
      gz += this.hf.getHeight(x, z + e) - this.hf.getHeight(x, z - e);
    }
    const l = Math.hypot(gx, gz) || 1;
    return [gx / l, gz / l];
  }

  /**
   * Finds a real waterfront near an authored anchor.
   *
   * The anchors in Archipelago.ts are chosen on the landform before erosion runs, and
   * erosion moves things: the first site picked for the port ended up two metres under
   * water once the valley behind it had been cut. So the anchor is treated as a wish and
   * the ground is asked where the town can actually stand — low, dry, close to the
   * water, with a slope behind it that a street can climb.
   */
  private snapToShore(ax: number, az: number, radius: number): { x: number; z: number } {
    let best: { x: number; z: number; score: number } | null = null;
    for (let z = az - radius; z <= az + radius; z += 25) {
      for (let x = ax - radius; x <= ax + radius; x += 25) {
        if (Math.hypot(x - ax, z - az) > radius) continue;
        const h = this.hf.getHeight(x, z);
        if (h < 2.0 || h > 26) continue;
        const cd = this.hf.coastDistance(x, z);
        if (cd > -20 || cd < -320) continue;
        const [ux, uz] = this.inland(x, z);
        const h4 = this.hf.getHeight(x + ux * 400, z + uz * 400);
        const h9 = this.hf.getHeight(x + ux * 900, z + uz * 900);
        if (h4 < h + 8) continue;
        const grade = (h4 - h) / 400;
        if (grade > 0.34) continue;
        const score = h4 * 0.5 + h9 * 0.25
                    - Math.abs(grade - 0.15) * 700
                    - Math.abs(h - 6) * 2.5
                    - Math.hypot(x - ax, z - az) * 0.02;
        if (!best || score > best.score) best = { x, z, score };
      }
    }
    return best ?? { x: ax, z: az };
  }

  private planPort() {
    const site = this.snapToShore(PORT.x, PORT.z, 1400);
    const cx = site.x, cz = site.z;
    this.portSite = site;
    const { core, sprawl } = PORT;
    const inside = (x: number, z: number) => {
      const d = Math.hypot(x - cx, z - cz);
      if (d > sprawl) return false;
      const h = this.hf.getHeight(x, z);
      return h > 2.0 && h < 300;
    };
    // Terraced streets, every twelve metres of altitude. Twelve because that is about
    // four storeys, and a hill town's terraces are one building deep.
    const base = this.hf.getHeight(cx, cz);
    const [ux, uz] = this.inland(cx, cz);
    for (let level = 0; level < 13; level++) {
      const h = base + 3 + level * 12.5;
      // Seed the contour on the line running inland from the waterfront.
      let sx = cx, sz = cz, found = false;
      for (let t = 0; t < 2400; t += 10) {
        const px = cx + ux * t, pz = cz + uz * t;
        if (!inside(px, pz)) break;
        if (this.hf.getHeight(px, pz) >= h) { sx = px; sz = pz; found = true; break; }
      }
      if (!found) continue;
      const st = this.streetAt(sx, sz, h, 2400 - level * 90, level < 3 ? 9 : 6.5, level < 3 ? 'main' : 'lane', inside);
      if (!st) continue;
      this.buildAlong(st, cx, cz, core, sprawl, level);
    }
    // The waterfront itself: a quay road along the shoreline of the bay.
    this.planWaterfront(cx, cz, -ux, -uz);
  }

  /**
   * Density and type from where you are: the old quarter on the water, blocks behind it,
   * houses on the slope, farms at the edge. Read from the air this gradation is the one
   * thing that says town rather than scatter.
   */
  private zoneFor(d: number, core: number, sprawl: number, level: number): { types: string[]; p: number } {
    const t = clamp((d - core) / (sprawl - core), 0, 1);
    if (t < 0.18 && level < 4) return { types: ['Town_A', 'Town_B', 'Town_C', 'Town_D', 'Shop', 'Town_A', 'Town_B'], p: 0.97 };
    if (t < 0.40) return { types: ['Town_B', 'Town_C', 'Terrace', 'Block_C', 'Town_A', 'Shop', 'Block_A'], p: 0.86 };
    if (t < 0.62) return { types: ['Block_A', 'Block_C', 'Terrace', 'House_B', 'Block_B', 'House_A'], p: 0.62 };
    if (t < 0.82) return { types: ['House_A', 'House_B', 'Villa', 'House_A', 'Block_C'], p: 0.36 };
    return { types: ['House_A', 'Villa', 'Farm', 'House_B'], p: 0.16 };
  }

  private buildAlong(st: Street, cx: number, cz: number, core: number, sprawl: number, level: number) {
    const pts = st.pts;
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const seg = a.distanceTo(b);
      if (seg < 1e-4) continue;
      const dx = (b.x - a.x) / seg, dz = (b.y - a.y) / seg;
      let s = 0;
      while (s < seg) {
        const px = a.x + dx * (s + acc % 1), pz = a.y + dz * (s + acc % 1);
        const d = Math.hypot(px - cx, pz - cz);
        const zone = this.zoneFor(d, core, sprawl, level);
        const type = zone.types[Math.floor(this.rnd() * zone.types.length)];
        const A = ARCH[type];
        const pitch = Math.max(A.w, 7) + 1.5 + this.rnd() * (level < 3 ? 2 : 9);
        // Fade the last third of the sprawl to nothing. A town that stops on a circle
        // reads as a stamp; the eye wants dense, then loose, then the odd farm, then bare.
        const edge = 1 - smoothstep(0.62, 1.02, d / sprawl);
        if (this.rnd() < zone.p * edge) {
          for (const side of [-1, 1] as const) {
            if (this.rnd() > (level < 4 ? 0.92 : 0.66)) continue;
            const off = st.width / 2 + A.d / 2 + 1.2;
            const bx = px - dz * side * off, bz = pz + dx * side * off;
            // The front faces the street: the archetype's front is its -Y in Blender,
            // which arrives as +Z here, so the heading is the outward normal reversed.
            const rot = Math.atan2(dz * side, -dx * side);
            this.place(type, bx, bz, rot, 1);
          }
        }
        s += pitch;
        acc += pitch;
      }
    }
  }

  /** The quay road, the sheds behind it, the cranes on it, and the moorings. */
  private planWaterfront(cx: number, cz: number, fx: number, fz: number) {
    // Walk the shoreline from the town centre, keeping to the two-metre contour.
    const inside = (x: number, z: number) => Math.hypot(x - cx, z - cz) < PORT.sprawl * 0.8;
    const h0 = 2.2;
    let sx = cx, sz = cz;
    for (let t = 0; t < 900; t += 6) {
      const px = cx + fx * t, pz = cz + fz * t;
      if (this.hf.getHeight(px, pz) < h0) break;
      sx = px; sz = pz;
    }
    const quay = this.streetAt(sx, sz, h0, 1800, 16, 'coast', inside);
    if (!quay) return;
    const pts = quay.pts;
    // Sheds and cranes on the landward side, spaced out; moorings on the water side.
    for (let i = 4; i < pts.length - 4; i += 5) {
      const a = pts[i - 1], b = pts[i + 1];
      const dx = b.x - a.x, dz = b.y - a.y, L = Math.hypot(dx, dz) || 1;
      const ux = dx / L, uz = dz / L;
      const rot = Math.atan2(-uz, ux);
      const land = this.hf.getHeight(pts[i].x - uz * 60, pts[i].y + ux * 60) >
                   this.hf.getHeight(pts[i].x + uz * 60, pts[i].y - ux * 60) ? 1 : -1;
      const r = this.rnd();
      const type = r < 0.34 ? 'QuayShed' : r < 0.55 ? 'Warehouse' : r < 0.72 ? 'Shed' : r < 0.85 ? 'Crane' : 'Silo';
      // Sheds set back from the edge, the crane right on it.
      const off = type === 'Crane' ? 13 : 32;
      this.place(type, pts[i].x - uz * land * off, pts[i].y + ux * land * off, rot, 1);
      // The mooring is where the water actually is, found by walking out from the quay.
      // Guessed at a fixed offset, it put every boat in the town's back garden.
      let mx = pts[i].x, mz = pts[i].y;
      for (let t = 8; t <= 140; t += 6) {
        const px = pts[i].x + uz * land * t, pz = pts[i].y - ux * land * t;
        if (this.hf.getHeight(px, pz) < -2.0) { mx = px; mz = pz; break; }
      }
      if (mx !== pts[i].x || mz !== pts[i].y) this.moorings.push({ x: mx, z: mz, rot });
    }
  }

  // ---- villages ------------------------------------------------------------

  private planVillage(cx: number, cz: number, r: number) {
    const inside = (x: number, z: number) => {
      const d = Math.hypot(x - cx, z - cz);
      return d < r * 4.5 && this.hf.getHeight(x, z) > 2.5;
    };
    const base = this.hf.getHeight(cx, cz);
    const church = { x: cx, z: cz };
    this.place('Church', church.x, church.z, this.rnd() * Math.PI * 2, 1);
    this.clearings.push({ x: church.x, z: church.z, r: 34 });
    for (let level = 0; level < 3; level++) {
      const st = this.streetAt(cx, cz, base + level * 9, 900, 7, level === 0 ? 'main' : 'lane', inside);
      if (!st) continue;
      const pts = st.pts;
      for (let i = 2; i < pts.length - 2; i += 2) {
        for (const side of [-1, 1] as const) {
          if (this.rnd() > 0.5) continue;
          const a = pts[i - 1], b = pts[i + 1];
          const dx = b.x - a.x, dz = b.y - a.y, L = Math.hypot(dx, dz) || 1;
          const ux = dx / L, uz = dz / L;
          const type = ['House_A', 'House_B', 'Town_C', 'House_A', 'Shop', 'Villa'][Math.floor(this.rnd() * 6)];
          const off = st.width / 2 + ARCH[type].d / 2 + 2 + this.rnd() * 6;
          const bx = pts[i].x - uz * side * off, bz = pts[i].y + ux * side * off;
          if (Math.hypot(bx - church.x, bz - church.z) < 30) continue;
          this.place(type, bx, bz, Math.atan2(uz * side, -ux * side), 1);
        }
      }
    }
  }

  // ---- the rest of the island ----------------------------------------------

  /**
   * Farms and isolated houses, thinning out to nothing. The gradation only reads if
   * there is something between the last street of a village and empty ground.
   */
  private planScattered() {
    const half = WORLD_SIZE / 2;
    const taken: { x: number; z: number }[] = this.placements.map((p) => ({ x: p.x, z: p.z }));
    const near = (x: number, z: number, r: number) => taken.some((t) => (t.x - x) ** 2 + (t.z - z) ** 2 < r * r);
    for (let i = 0; i < 5200; i++) {
      const x = (this.rnd() * 2 - 1) * half * 0.86;
      const z = (this.rnd() * 2 - 1) * half * 0.86;
      const h = this.hf.getHeight(x, z);
      if (h < 6 || h > 260) continue;
      if (this.hf.getSlope(x, z) > 0.20) continue;
      if (this.hf.coastDistance(x, z) > -40) continue;
      // Habitation follows the lowland and the coast, thinning inland and upward.
      const field = this.noise.fbm2D(x * 0.00042 + 12, z * 0.00042 - 5, 3) * 0.5 + 0.5;
      const coast = 1 - smoothstep(120, 1400, -this.hf.coastDistance(x, z));
      const p = (0.18 + 0.55 * field) * (0.35 + 0.65 * coast) * (1 - smoothstep(90, 240, h));
      if (this.rnd() > p * 0.5) continue;
      if (near(x, z, 240)) continue;
      const r = this.rnd();
      const type = r < 0.40 ? 'Farm' : r < 0.62 ? 'House_A' : r < 0.80 ? 'House_B' : r < 0.92 ? 'Villa' : 'Shed';
      this.place(type, x, z, this.rnd() * Math.PI * 2, 1);
      taken.push({ x, z });
      // A farm brings a shed and sometimes a silo.
      if (type === 'Farm') {
        const a = this.rnd() * Math.PI * 2, dd = 34 + this.rnd() * 20;
        this.place(this.rnd() < 0.3 ? 'Silo' : 'Shed', x + Math.cos(a) * dd, z + Math.sin(a) * dd, this.rnd() * Math.PI * 2, 1);
      }
    }
  }

  /** The lighthouse, the airfield's hangars and the bridge. */
  private planSpecials() {
    this.place('Lighthouse', LIGHTHOUSE.x, LIGHTHOUSE.z, 0.6, 1);
    for (const af of AIRFIELDS) {
      if (!af.apron) continue;
      const a = (af.heading - 90) * Math.PI / 180;
      const ca = Math.cos(a), sa = Math.sin(a);
      const px = af.x + af.apron.dx * ca - af.apron.dz * sa;
      const pz = af.z + af.apron.dx * sa + af.apron.dz * ca;
      const n = af.id === 'main' ? 3 : 1;
      for (let i = 0; i < n; i++) {
        const ox = (i - (n - 1) / 2) * 46;
        this.place(af.id === 'main' && i === 1 ? 'Warehouse' : 'Shed',
          px + ox * ca - 44 * sa, pz + ox * sa + 44 * ca, -a, 1);
      }
      this.place('WaterTower', px - 70 * ca - 60 * sa, pz - 70 * sa + 60 * ca, 0, 1);
    }
    // The bridge: two towers on the banks and a deck laid across, section by section.
    const S = STRAIT, sa = S.a, sb = S.b ?? S.a;
    const bx = sa[0] + (sb[0] - sa[0]) * S.at, bz = sa[1] + (sb[1] - sa[1]) * S.at;
    const dx = sb[0] - sa[0], dz = sb[1] - sa[1], L = Math.hypot(dx, dz);
    const ux = dx / L, uz = dz / L;              // along the channel
    const nx = -uz, nz = ux;                     // across it: the road's direction
    const rot = Math.atan2(nz, nx) + Math.PI / 2;
    for (const side of [-1, 1] as const) {
      const t = side * (S.halfWidth + 105);
      const tx = bx + nx * t, tz = bz + nz * t;
      this.place('BridgeTower', tx, tz, rot, 1, this.hf.getHeight(tx, tz) - 3);
    }
    const n = Math.ceil(S.span / 20);
    for (let i = 0; i < n; i++) {
      const t = (i - (n - 1) / 2) * 20;
      this.place('BridgeDeck', bx + nx * t, bz + nz * t, rot, 1, S.deckHeight);
    }
    this.buildBridgeCables(bx, bz, nx, nz, S.halfWidth + 105, S.deckHeight, S.towerHeight);
  }

  /**
   * The main cables and their hangers.
   *
   * Built here rather than in Blender because a catenary is a function of the span it
   * hangs across, and the span is a property of the strait, not of a model. Without them
   * the crossing reads as two towers with a plank between them; with them it reads as
   * the thing you are about to fly under.
   */
  private buildBridgeCables(bx: number, bz: number, nx: number, nz: number,
                            half: number, deck: number, towerH: number) {
    const pts: THREE.Vector3[] = [];
    const top = deck + towerH - 4;
    const sag = towerH - 10;
    const N = 46;
    const pos: number[] = [];
    const push = (a: THREE.Vector3, b: THREE.Vector3) => {
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    };
    for (const side of [-1, 1] as const) {
      // The cable runs along the deck, offset to its edge; the deck is 18 m wide.
      const ox = -nz * side * 8.6, oz = nx * side * 8.6;
      let prev: THREE.Vector3 | null = null;
      for (let i = 0; i <= N; i++) {
        const u = (i / N) * 2 - 1;                      // -1 at one tower, +1 at the other
        const t = u * half;
        // A catenary is close enough to a parabola over one span, and a parabola is one
        // multiply. The eye is checking the sag, not the transcendental.
        const y = top - sag * (1 - u * u);
        const p = new THREE.Vector3(bx + nx * t + ox, y, bz + nz * t + oz);
        if (prev) push(prev, p);
        prev = p;
        pts.push(p);
        // Hangers, every other station, down to the deck.
        if (i % 2 === 0 && Math.abs(u) < 0.97 && y > deck + 2) {
          push(p, new THREE.Vector3(p.x, deck + 1.2, p.z));
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeBoundingSphere();
    const mat = new THREE.LineBasicMaterial({ color: 0x2b2c2e });
    (mat as any)._apKey = 'cable';
    applyAerialPerspective(mat);
    const lines = new THREE.LineSegments(g, mat);
    lines.frustumCulled = false;
    this.add(lines);
    this.cableMat = mat;
    void pts;
  }

  private cableMat: THREE.Material | null = null;

  // ---- placement -----------------------------------------------------------

  /** True if nothing else is standing here. Also records the claim. */
  private claim(x: number, z: number, r: number): boolean {
    const C = 60;
    const gi = Math.floor(x / C), gj = Math.floor(z / C);
    for (let j = gj - 1; j <= gj + 1; j++) for (let i = gi - 1; i <= gi + 1; i++) {
      const cell = this.occ.get(i * 65536 + j);
      if (!cell) continue;
      for (const o of cell) {
        const rr = (o.r + r) * 0.82;
        if ((o.x - x) ** 2 + (o.z - z) ** 2 < rr * rr) return false;
      }
    }
    const k = gi * 65536 + gj;
    let cell = this.occ.get(k);
    if (!cell) this.occ.set(k, cell = []);
    cell.push({ x, z, r });
    return true;
  }

  private place(type: string, x: number, z: number, rot: number, scale: number, y?: number) {
    const A = ARCH[type];
    if (!A) return;
    const gy = y ?? this.hf.getHeight(x, z);
    if (y === undefined && gy < 1.0 && A.cat !== 'boat') return;
    // Only buildings compete for ground. A lamp post, a pier or a buoy is street
    // furniture and is allowed to stand next to whatever it is furnishing.
    if ((A.cat === 'old' || A.cat === 'house' || A.cat === 'block' || A.cat === 'civic' || A.cat === 'works')
        && !this.claim(x, z, Math.hypot(A.w, A.d) * 0.42)) return;
    const tint = new THREE.Color(WALL_PALETTE[Math.floor(this.rnd() * WALL_PALETTE.length)]);
    // Weathering: a slow drift towards grey, different for every building.
    tint.lerp(new THREE.Color(0x8f8a80), this.rnd() * 0.45);
    const pl: Placement = { type, x, z, y: gy, rot, scale, tint, seed: this.rnd() };
    this.placements.push(pl);
    if (A.cat !== 'boat') this.clearings.push({ x, z, r: Math.max(A.w, A.d) * 0.75 + 6 });
  }

  // ---- carving -------------------------------------------------------------

  /**
   * Cuts the plots and the streets into the terrain.
   *
   * Order matters: streets first, so that a building sitting on one still ends up level
   * with its own doorstep rather than with the hillside the street was cut out of.
   */
  private carve() {
    for (const st of this.streets) {
      for (let i = 1; i < st.pts.length; i++) {
        const a = st.pts[i - 1], b = st.pts[i];
        const y = (this.hf.getHeight(a.x, a.y) + this.hf.getHeight(b.x, b.y)) / 2;
        this.hf.flattenSegment(a.x, a.y, b.x, b.y, st.width, y, st.width * 1.6);
      }
    }
    for (const p of this.placements) {
      const A = ARCH[p.type];
      if (A.cat === 'boat' || p.type.startsWith('Bridge')) { this.addSolid(p); continue; }
      p.y = this.hf.getHeight(p.x, p.z);
      this.hf.flattenRect(p.x, p.z, A.w + 3.5, A.d + 3.5, p.rot, p.y, 7);
      p.y = this.hf.getHeight(p.x, p.z);
      this.addSolid(p);
    }
  }

  /** Paints the built-up coverage map the terrain shader reads at any distance. */
  private rasterise() {
    const M = Settlement.MAP, half = WORLD_SIZE / 2, cell = WORLD_SIZE / M;
    const stamp = (x: number, z: number, r: number, ch: number, v: number) => {
      const i0 = Math.max(0, Math.floor((x + half - r) / cell)), i1 = Math.min(M - 1, Math.ceil((x + half + r) / cell));
      const j0 = Math.max(0, Math.floor((z + half - r) / cell)), j1 = Math.min(M - 1, Math.ceil((z + half + r) / cell));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const px = -half + (i + 0.5) * cell, pz = -half + (j + 0.5) * cell;
        const d = Math.hypot(px - x, pz - z);
        if (d > r) continue;
        const w = v * (1 - smoothstep(r * 0.4, r, d));
        const k = (j * M + i) * 4 + ch;
        this.mapData[k] = Math.min(255, this.mapData[k] + w * 255);
      }
    };
    for (const p of this.placements) {
      const A = ARCH[p.type];
      if (A.cat === 'boat') continue;
      stamp(p.x, p.z, Math.max(A.w, A.d) * 0.62 + 6, 0, 0.75);
      stamp(p.x, p.z, Math.max(A.w, A.d) * 0.5, 2, 0.5);
    }
    for (const st of this.streets) {
      for (let i = 1; i < st.pts.length; i++) {
        const a = st.pts[i - 1], b = st.pts[i];
        const n = Math.max(1, Math.ceil(a.distanceTo(b) / (cell * 0.6)));
        for (let k = 0; k <= n; k++) {
          stamp(lerp(a.x, b.x, k / n), lerp(a.y, b.y, k / n), st.width * 0.8 + 4, 1, 0.55);
        }
      }
    }
    // The airfields are hard standing too. Left out of this map they are grass as far
    // as the vegetation is concerned, and a forest grows down the middle of the runway.
    for (const af of AIRFIELDS) {
      const ang = (af.heading - 90) * Math.PI / 180;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const n = Math.ceil(af.length / (cell * 0.5));
      for (let k = 0; k <= n; k++) {
        const t = (k / n - 0.5) * (af.length + 180);
        stamp(af.x + ca * t, af.z + sa * t, af.width * 0.5 + 60, 1, 0.5);
      }
      if (af.apron) {
        const a = af.apron;
        const px = af.x + a.dx * ca - a.dz * sa, pz = af.z + a.dx * sa + a.dz * ca;
        stamp(px, pz, Math.max(a.w, a.d) * 0.7 + 40, 1, 0.5);
      }
    }
    for (let k = 3; k < this.mapData.length; k += 4) this.mapData[k] = 255;
    this.townMap.needsUpdate = true;
  }

  /**
   * How built-up a point is, 0..1. Read straight off the coverage map rather than by
   * walking a list of two thousand clearings, which is what the vegetation would
   * otherwise have to do for every candidate tree.
   */
  /**
   * Is this point inside something solid? Buildings, the cranes, the bridge deck.
   *
   * The bridge is the reason this takes a height and not just a footprint: its deck is
   * a slab a hundred and sixty metres up, and the whole point of the strait is to go
   * under it.
   */
  solidAt(x: number, y: number, z: number): boolean {
    const C = 60;
    const gi = Math.floor(x / C), gj = Math.floor(z / C);
    for (let j = gj - 1; j <= gj + 1; j++) for (let i = gi - 1; i <= gi + 1; i++) {
      const cell = this.solids.get(i * 65536 + j);
      if (!cell) continue;
      for (const o of cell) {
        if (y < o.y0 || y > o.y1) continue;
        const dx = x - o.x, dz = z - o.z;
        const ca = Math.cos(-o.rot), sa = Math.sin(-o.rot);
        if (Math.abs(dx * ca - dz * sa) > o.hw) continue;
        if (Math.abs(dx * sa + dz * ca) > o.hd) continue;
        return true;
      }
    }
    return false;
  }

  private solids = new Map<number, { x: number; z: number; rot: number; hw: number; hd: number; y0: number; y1: number }[]>();

  private addSolid(p: Placement) {
    const A = ARCH[p.type];
    if (!A.h) return;
    const C = 60;
    const gi = Math.floor(p.x / C), gj = Math.floor(p.z / C);
    const k = gi * 65536 + gj;
    let cell = this.solids.get(k);
    if (!cell) this.solids.set(k, cell = []);
    const isDeck = p.type === 'BridgeDeck';
    cell.push({
      x: p.x, z: p.z, rot: p.rot, hw: A.w / 2, hd: A.d / 2,
      y0: isDeck ? p.y - 3.0 : p.y - 2, y1: p.y + A.h,
    });
  }

  builtAt(x: number, z: number): number {
    const M = Settlement.MAP, half = WORLD_SIZE / 2;
    const i = Math.round((x + half) / WORLD_SIZE * (M - 1));
    const j = Math.round((z + half) / WORLD_SIZE * (M - 1));
    if (i < 0 || j < 0 || i >= M || j >= M) return 0;
    const k = (j * M + i) * 4;
    return Math.max(this.mapData[k], this.mapData[k + 1]) / 255;
  }

  // ==========================================================================
  // Geometry
  // ==========================================================================

  /** The shared material, so anything that moves can be drawn with the same one. */
  get buildingMaterial() { return this.material(); }

  static async load(): Promise<Map<string, THREE.BufferGeometry>> {
    const gltf = await new GLTFLoader().loadAsync('/models/town.glb');
    const out = new Map<string, THREE.BufferGeometry>();
    for (const child of gltf.scene.children) {
      const parts: { geo: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial }[] = [];
      child.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) parts.push({ geo: m.geometry as THREE.BufferGeometry, mat: m.material as THREE.MeshStandardMaterial });
      });
      if (!parts.length) continue;
      out.set(child.name, mergeWithMaterials(parts));
    }
    return out;
  }

  /** Builds one instanced mesh per archetype. */
  build(geos: Map<string, THREE.BufferGeometry>) {
    const byType = new Map<string, Placement[]>();
    for (const p of this.placements) {
      if (!geos.has(p.type)) continue;
      let a = byType.get(p.type);
      if (!a) byType.set(p.type, a = []);
      a.push(p);
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), t = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (const [type, list] of byType) {
      const geo = geos.get(type)!.clone();
      const tints = new Float32Array(list.length * 3);
      const seeds = new Float32Array(list.length);
      const mesh = new THREE.InstancedMesh(geo, this.material(), list.length);
      list.forEach((p, i) => {
        q.setFromAxisAngle(up, p.rot);
        t.set(p.x, p.y, p.z);
        s.setScalar(p.scale);
        mesh.setMatrixAt(i, m.compose(t, q, s));
        tints[i * 3] = p.tint.r; tints[i * 3 + 1] = p.tint.g; tints[i * 3 + 2] = p.tint.b;
        seeds[i] = p.seed;
      });
      geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tints, 3));
      geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.meshes.push(mesh);
      this.add(mesh);
    }
  }

  private sharedMaterial: THREE.MeshStandardMaterial | null = null;

  /**
   * One material for the whole built world.
   *
   * The base colour comes from the vertex colours baked out of Blender's materials, and
   * the per-instance wall tint is applied only to the parts marked as wall, so a roof
   * stays terracotta on a house painted ochre. Windows are their own part, which is what
   * lets a single building light up at dusk without its walls glowing.
   */
  private material() {
    if (this.sharedMaterial) return this.sharedMaterial;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.0 });
    (mat as any)._apKey = 'town';
    applyAerialPerspective(mat, (shader) => {
      shader.uniforms.uCull = this.uCull;
      shader.uniforms.uNight = this.uNight;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec2 aMat;      // x: 0 wall 1 roof 2 window 3 detail   y: roughness
          attribute vec3 aTint;
          attribute float aSeed;
          attribute float aFlap;      // wing beat, on the birds; zero everywhere else
          uniform float uCull;
          varying float vPart;
          varying float vRough;
          varying float vLit;`)
        .replace('#include <color_vertex>', `#include <color_vertex>
          vPart = aMat.x;
          vRough = aMat.y;
          // Walls take the instance's colour; roofs take a third of it, which keeps a
          // street from looking like one paint scheme and stops it from looking like ten.
          float wallW = 1.0 - step(0.5, vPart);
          float roofW = step(0.5, vPart) * (1.0 - step(1.5, vPart));
          vColor.rgb *= mix(vec3(1.0), aTint, wallW) * mix(vec3(1.0), mix(vec3(1.0), aTint, 0.34), roofW);
          // Which buildings have their lights on tonight, and how warm they are.
          vLit = step(0.42, fract(aSeed * 71.317));`)
        .replace('#include <project_vertex>', `
          // Wing beat. Buildings have no aFlap attribute, so it reads as zero for them
          // and this line costs them one multiply.
          transformed.z += abs(transformed.x) * aFlap * 0.55;
          #ifdef USE_INSTANCING
            // Beyond the cull distance the instance is collapsed onto its own origin.
            // The triangles still go through the vertex stage but cover no pixels, which
            // is most of the cost, and it costs nothing to be wrong about for one frame.
            vec3 instOrg = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
            if (distance(cameraPosition, instOrg) > uCull) transformed = vec3(0.0);
          #endif
          #include <project_vertex>`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uNight;
          varying float vPart;
          varying float vRough;
          varying float vLit;`)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vRough;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          // Windows at dusk. Not all at once and not all the same: a street lights up
          // building by building over the half hour the sun takes to go.
          // Clamped: without the max, every wall carries a negative emissive and the
          // whole town glows in the wrong direction after dark.
          float win = max(0.0, 1.0 - abs(vPart - 2.0));
          totalEmissiveRadiance += vec3(1.0, 0.74, 0.46) * (win * vLit * uNight * 1.45);
          // Street lamps are all on, and a lantern is a tenth the area of a window with
          // a curtain: at the same radiance a row of them blooms into white discs.
          float lamp = max(0.0, 1.0 - abs(vPart - 4.0));
          totalEmissiveRadiance += vec3(1.0, 0.83, 0.58) * (lamp * uNight * 0.55);`);
    });
    this.sharedMaterial = mat;
    return mat;
  }

  get materials() { return [this.sharedMaterial, this.roadMat].filter(Boolean) as THREE.Material[]; }

  update(_dt: number, night: number) { this.uNight.value = night; }
}

/**
 * Merges a glTF object's per-material meshes into one geometry, baking each material's
 * base colour into vertex colours and its role into an attribute. One geometry means one
 * instanced draw call for a whole archetype, and the role is what the shader needs to
 * know which part of a house to repaint and which part to light up at night.
 */
function mergeWithMaterials(parts: { geo: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial }[]): THREE.BufferGeometry {
  let vCount = 0, iCount = 0;
  for (const p of parts) {
    vCount += p.geo.getAttribute('position').count;
    iCount += p.geo.index ? p.geo.index.count : p.geo.getAttribute('position').count;
  }
  const position = new Float32Array(vCount * 3), normal = new Float32Array(vCount * 3);
  const color = new Float32Array(vCount * 3), aMat = new Float32Array(vCount * 2);
  const index = new Uint16Array(iCount);
  let vo = 0, io = 0;
  for (const p of parts) {
    const pos = p.geo.getAttribute('position'), nor = p.geo.getAttribute('normal');
    position.set(pos.array as Float32Array, vo * 3);
    if (nor) normal.set(nor.array as Float32Array, vo * 3);
    const name = p.mat.name || '';
    // 0 wall (tinted per instance) · 1 roof · 2 window (lit at dusk, per building)
    // 3 detail · 4 street lamp (always lit, and far dimmer than a lit room)
    const part = name.startsWith('W_') ? 0 : name.startsWith('R_') ? 1
               : name.startsWith('G_') ? 2 : name.startsWith('L_') ? 4 : 3;
    const c = p.mat.color;
    for (let i = 0; i < pos.count; i++) {
      color[(vo + i) * 3] = c.r; color[(vo + i) * 3 + 1] = c.g; color[(vo + i) * 3 + 2] = c.b;
      aMat[(vo + i) * 2] = part;
      aMat[(vo + i) * 2 + 1] = part === 2 ? 0.16 : p.mat.roughness;
    }
    const idx = p.geo.index;
    if (idx) for (let i = 0; i < idx.count; i++) index[io++] = idx.getX(i) + vo;
    else for (let i = 0; i < pos.count; i++) index[io++] = i + vo;
    vo += pos.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  g.setAttribute('color', new THREE.BufferAttribute(color, 3));
  g.setAttribute('aMat', new THREE.BufferAttribute(aMat, 2));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeBoundingSphere();
  return g;
}
