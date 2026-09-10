import * as THREE from 'three';
import { Heightfield, WORLD_SIZE } from './Heightfield';
import { applyAerialPerspective } from '../sky/AerialPerspective';
import terrainChunk from '../shaders/terrain.glsl?raw';

/**
 * Terrain as a quadtree.
 *
 * A twenty-six kilometre map cannot be tiled uniformly: a grid fine enough for the
 * cliffs at the strait is tens of thousands of tiles, and a grid coarse enough to draw
 * turns every distant ridge into a mesa. So the map is subdivided towards the camera
 * instead — a node splits while it is closer than a few times its own width — which
 * spends vertices where they are looked at and holds the whole world in around a
 * hundred and fifty draw calls.
 *
 * Two neighbours can then differ by one level, which would leave a crack along their
 * shared edge. Rather than hide it under a skirt (a vertical curtain, always in front
 * of the neighbour's surface on sloping ground, and it reads as banding), the finer
 * node collapses every other vertex on that edge onto the line its coarse neighbour
 * draws. The two surfaces are then the same surface, exactly.
 */

const SEG = 64;                 // quads per node side
const MAX_LEVEL = 6;            // 26000 / 2^6 = 406 m nodes, 6.3 m between vertices
const LOD_K = 3.0;              // split while distance < LOD_K * node size
const MAX_CACHED = 420;         // geometries kept alive; each is about 135 kB

interface Node {
  x0: number; z0: number; size: number; level: number;
  /** Extremes of the terrain inside, for culling and for skipping the sea floor. */
  minH: number; maxH: number;
  children: Node[] | null;
  mesh: THREE.Mesh | null;
  /** Cached geometry per stitching mask. */
  geos: Map<number, THREE.BufferGeometry>;
  lastUsed: number;
}

export class Terrain extends THREE.Group {
  readonly material: THREE.MeshStandardMaterial;
  private root: Node;
  private frame = 0;
  private live: THREE.Mesh[] = [];
  private cached: Node[] = [];
  private box = new THREE.Box3();

  constructor(readonly hf: Heightfield, loader: THREE.TextureLoader) {
    super();
    this.material = this.makeMaterial(loader);
    this.root = this.makeNode(-WORLD_SIZE / 2, -WORLD_SIZE / 2, WORLD_SIZE, 0);
    this.frustumCulled = false;
  }

  private makeNode(x0: number, z0: number, size: number, level: number): Node {
    // Sample coarsely for the bounds. The margin of one extra ring matters: a node
    // whose corners are all under water can still have a rock in the middle of it.
    let minH = Infinity, maxH = -Infinity;
    const N = 6;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const h = this.hf.getHeight(x0 + i * size / N, z0 + j * size / N);
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
    }
    return { x0, z0, size, level, minH, maxH, children: null, mesh: null, geos: new Map(), lastUsed: 0 };
  }

  /** Squared distance from a point to the node's footprint, on the ground plane. */
  private distTo(n: Node, x: number, z: number): number {
    const dx = Math.max(n.x0 - x, 0, x - (n.x0 + n.size));
    const dz = Math.max(n.z0 - z, 0, z - (n.z0 + n.size));
    return Math.hypot(dx, dz);
  }

  private shouldSplit(n: Node, cx: number, cz: number): boolean {
    if (n.level >= MAX_LEVEL) return false;
    return this.distTo(n, cx, cz) < n.size * LOD_K;
  }

  /** Level of the leaf covering a point — used to find out what a neighbour is doing. */
  private levelAt(x: number, z: number, cx: number, cz: number): number {
    let n = this.root;
    while (this.shouldSplit(n, cx, cz)) {
      if (!n.children) return n.level + 1;   // it would split, so treat it as split
      const half = n.size / 2;
      const i = x >= n.x0 + half ? 1 : 0, j = z >= n.z0 + half ? 1 : 0;
      n = n.children[j * 2 + i];
    }
    return n.level;
  }

  private collect(n: Node, cx: number, cz: number, out: Node[]) {
    if (n.maxH < -1.5) return;               // entirely sea floor: the ocean covers it
    if (this.shouldSplit(n, cx, cz)) {
      if (!n.children) {
        const h = n.size / 2;
        n.children = [
          this.makeNode(n.x0, n.z0, h, n.level + 1),
          this.makeNode(n.x0 + h, n.z0, h, n.level + 1),
          this.makeNode(n.x0, n.z0 + h, h, n.level + 1),
          this.makeNode(n.x0 + h, n.z0 + h, h, n.level + 1),
        ];
      }
      for (const c of n.children) this.collect(c, cx, cz, out);
    } else {
      out.push(n);
    }
  }

  /** Rebuilds the visible set. Cheap enough to run every frame. */
  update(camera: THREE.Camera) {
    const cx = camera.position.x, cz = camera.position.z;
    this.frame++;
    const leaves: Node[] = [];
    this.collect(this.root, cx, cz, leaves);

    let used = 0;
    for (const n of leaves) {
      // Which edges border a coarser neighbour. Probed one third of a node outside the
      // edge, which lands inside the neighbour whatever its size.
      const s = n.size, o = s * 0.34;
      let mask = 0;
      if (this.levelAt(n.x0 + s / 2, n.z0 - o, cx, cz) < n.level) mask |= 1;   // -Z
      if (this.levelAt(n.x0 + s + o, n.z0 + s / 2, cx, cz) < n.level) mask |= 2;   // +X
      if (this.levelAt(n.x0 + s / 2, n.z0 + s + o, cx, cz) < n.level) mask |= 4;   // +Z
      if (this.levelAt(n.x0 - o, n.z0 + s / 2, cx, cz) < n.level) mask |= 8;   // -X

      let geo = n.geos.get(mask);
      if (!geo) {
        geo = this.buildGeometry(n, mask);
        n.geos.set(mask, geo);
        if (n.geos.size === 1) this.cached.push(n);
      }
      let mesh = this.live[used];
      if (!mesh) {
        mesh = new THREE.Mesh(geo, this.material);
        mesh.castShadow = true; mesh.receiveShadow = true;
        this.add(mesh);
        this.live[used] = mesh;
      }
      mesh.geometry = geo;
      mesh.visible = true;
      n.lastUsed = this.frame;
      used++;
    }
    // Park the meshes we no longer need rather than removing them: the count is stable
    // from frame to frame, so this settles immediately.
    for (let i = used; i < this.live.length; i++) this.live[i].visible = false;
    this.trim();
  }

  /** Drops the geometry of nodes that have not been drawn for a while. */
  private trim() {
    if (this.cached.length <= MAX_CACHED) return;
    this.cached.sort((a, b) => a.lastUsed - b.lastUsed);
    while (this.cached.length > MAX_CACHED * 0.8) {
      const n = this.cached.shift()!;
      if (n.lastUsed === this.frame) { this.cached.push(n); break; }
      for (const g of n.geos.values()) g.dispose();
      n.geos.clear();
    }
  }

  private buildGeometry(n: Node, mask: number): THREE.BufferGeometry {
    const hf = this.hf;
    const w = SEG + 1;
    const step = n.size / SEG;
    const pos = new Float32Array(w * w * 3);
    const nor = new Float32Array(w * w * 3);
    const uv = new Float32Array(w * w * 2);
    const tmp = new THREE.Vector3();

    let p = 0, q = 0;
    for (let j = 0; j < w; j++) {
      const z = n.z0 + j * step;
      for (let i = 0; i < w; i++) {
        const x = n.x0 + i * step;
        pos[p] = x; pos[p + 1] = hf.getHeight(x, z); pos[p + 2] = z;
        hf.getNormal(x, z, tmp, step * 0.85);
        nor[p] = tmp.x; nor[p + 1] = tmp.y; nor[p + 2] = tmp.z;
        p += 3;
        uv[q++] = i / SEG; uv[q++] = j / SEG;
      }
    }
    // Stitching: on an edge shared with a coarser neighbour, the odd vertices are moved
    // onto the segment its two even neighbours span, which is the line the neighbour
    // actually draws there. Normals follow, or the seam shows up as a lighting crease.
    const collapse = (a: number, b: number, c: number) => {
      for (let k = 0; k < 3; k++) {
        pos[b * 3 + k] = (pos[a * 3 + k] + pos[c * 3 + k]) * 0.5;
        nor[b * 3 + k] = (nor[a * 3 + k] + nor[c * 3 + k]) * 0.5;
      }
      const l = Math.hypot(nor[b * 3], nor[b * 3 + 1], nor[b * 3 + 2]) || 1;
      nor[b * 3] /= l; nor[b * 3 + 1] /= l; nor[b * 3 + 2] /= l;
    };
    for (let i = 1; i < SEG; i += 2) {
      if (mask & 1) collapse(i - 1, i, i + 1);
      if (mask & 4) { const r = SEG * w; collapse(r + i - 1, r + i, r + i + 1); }
      if (mask & 8) collapse((i - 1) * w, i * w, (i + 1) * w);
      if (mask & 2) collapse((i - 1) * w + SEG, i * w + SEG, (i + 1) * w + SEG);
    }

    const idx = new Uint16Array(SEG * SEG * 6);
    let t = 0;
    for (let j = 0; j < SEG; j++) for (let i = 0; i < SEG; i++) {
      const a = j * w + i, b = a + 1, c = a + w, d = c + 1;
      idx[t++] = a; idx[t++] = c; idx[t++] = b;
      idx[t++] = b; idx[t++] = c; idx[t++] = d;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.box.min.set(n.x0, n.minH - 6, n.z0);
    this.box.max.set(n.x0 + n.size, n.maxH + 6, n.z0 + n.size);
    g.boundingBox = this.box.clone();
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    return g;
  }


  /**
   * Tileable, isotropic value-noise fBm, three fields in one texture.
   *
   * The usual way to make a seamless texture out of simplex noise is to sample it round
   * a torus, mixing the two angles into both coordinates. It tiles, but it is not
   * isotropic: the mixing stretches the field along one diagonal, and every use of it —
   * the ground's macro variation, the canopy relief — inherits a diagonal weave that
   * reads as hatching across a whole hillside. A periodic lattice has neither problem:
   * the noise wraps because the lattice indices wrap, and nothing is stretched.
   *
   * All three fields share one texture because the terrain shader is already at sixteen
   * samplers — five material sets, three shadow cascades, the environment and the cloud
   * map — and the seventeenth does not fail loudly. The program simply refuses to link
   * and the ground renders white.
   */
  static makeMacroNoise(N = 256): THREE.DataTexture {
    const fade = (t: number) => t * t * (3 - 2 * t);
    const field = (freq: number, octaves: number, seed: number) => {
      const hash = (ix: number, iy: number, o: number) => {
        let h = Math.imul(ix + seed, 374761393) ^ Math.imul(iy + o * 9176 + seed, 668265263);
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
      };
      const buf = new Float32Array(N * N);
      let lo = Infinity, hi = -Infinity;
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        let v = 0, amp = 1, norm = 0, f = freq;
        for (let o = 0; o < octaves; o++) {
          const x = i / N * f, y = j / N * f;
          const ix = Math.floor(x), iy = Math.floor(y);
          const tx = fade(x - ix), ty = fade(y - iy);
          const w = (a: number, b: number) => hash(((a % f) + f) % f, ((b % f) + f) % f, o);
          const a0 = w(ix, iy), a1 = w(ix + 1, iy), b0 = w(ix, iy + 1), b1 = w(ix + 1, iy + 1);
          const top = a0 + (a1 - a0) * tx, bot = b0 + (b1 - b0) * tx;
          v += amp * (top + (bot - top) * ty);
          norm += amp; amp *= 0.5; f *= 2;
        }
        const u = v / norm;
        buf[j * N + i] = u;
        if (u < lo) lo = u;
        if (u > hi) hi = u;
      }
      for (let k = 0; k < buf.length; k++) buf[k] = (buf[k] - lo) / (hi - lo);
      return buf;
    };
    const r = field(4, 5, 77);      // macro variation, kilometre scale
    const g = field(13, 4, 991);    // canopy relief, tens of metres
    const b = field(7, 5, 4211);    // a third, decorrelated field for whatever needs one
    const data = new Uint8Array(N * N * 4);
    for (let k = 0; k < N * N; k++) {
      data[k * 4] = r[k] * 255; data[k * 4 + 1] = g[k] * 255; data[k * 4 + 2] = b[k] * 255; data[k * 4 + 3] = 255;
    }
    const t = new THREE.DataTexture(data, N, N);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.needsUpdate = true;
    return t;
  }

  private makeMaterial(loader: THREE.TextureLoader): THREE.MeshStandardMaterial {
    const tex = (path: string, srgb = false) => {
      const t = loader.load(path);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = 8;
      return t;
    };
    const set = (name: string) => ({ D: tex(`/textures/${name}/albedo.webp`, true), N: tex(`/textures/${name}/nrm.webp`) });
    const grass = set('grass'), forest = set('forest'), cliff = set('rockface'), sand = set('sand'), scree = set('scree');

    const macro = Terrain.makeMacroNoise(256);

    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
    const uniforms = {
      tGrassD: { value: grass.D }, tGrassN: { value: grass.N },
      tForestD: { value: forest.D }, tForestN: { value: forest.N },
      tCliffD: { value: cliff.D }, tCliffN: { value: cliff.N },
      tSandD: { value: sand.D }, tSandN: { value: sand.N },
      tScreeD: { value: scree.D }, tScreeN: { value: scree.N },
      tMacro: { value: macro }, uSeaLevel: { value: 0 }, uGroundLift: { value: 1.0 },
    };
    (mat as any)._apKey = "terrain";
    (mat as any).terrainUniforms = uniforms;
    applyAerialPerspective(mat, (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTWorldPos; varying vec3 vTWorldNormal;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvTWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vTWorldNormal = normalize(mat3(modelMatrix) * objectNormal);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + terrainChunk)
        .replace('#include <map_fragment>', `
          vec3 tAlbedo; float tRough; float tAo;
          vec3 tWorldN = terrainSurface(tAlbedo, tRough, tAo);
          diffuseColor.rgb *= tAlbedo;`)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = tRough;')
        .replace('#include <normal_fragment_begin>', `
          float faceDirection = gl_FrontFacing ? 1.0 : -1.0;
          vec3 normal = normalize(mat3(viewMatrix) * tWorldN);
          vec3 nonPerturbedNormal = normal;`)
        .replace('#include <aomap_fragment>', '');
    });
    return mat;
  }
}
