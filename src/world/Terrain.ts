import * as THREE from 'three';
import { Heightfield, WORLD_SIZE } from './Heightfield';
import { applyAerialPerspective } from '../sky/AerialPerspective';
import terrainChunk from '../shaders/terrain.glsl?raw';
import { SimplexNoise } from '../core/Noise';

const CHUNKS = 24;                       // chunks per side
const CHUNK = WORLD_SIZE / CHUNKS;       // 375 m
// Coarse far LODs visibly truncate ridge lines — a 600 m peak sampled every 47 m turns
// into a mesa — so the distant tiers stay comparatively dense. Geometry is cheap next
// to this project's fragment work.
// Every level is a multiple of EDGE_BASE so that the vertices shared with a neighbour
// can be snapped to the same coarse anchors — that removes LOD cracks exactly, with no
// skirts. Skirts are a vertical curtain at the chunk border and on sloping ground they
// are always in front of the neighbour's surface, which reads as vertical banding.
const EDGE_BASE = 12;
const LOD_SEGMENTS = [60, 48, 36, 24, 12];
const LOD_DISTANCE = [750, 1700, 3400, 6000];

/**
 * Chunked, LOD'd terrain built from the heightfield. Each chunk lazily builds a
 * geometry per LOD; skirts hide LOD seams. One shared MeshStandardMaterial does
 * the PBR blending (see shaders/terrain.glsl) so CSM shadows and IBL just work.
 */
export class Terrain extends THREE.Group {
  readonly material: THREE.MeshStandardMaterial;
  private chunks: { mesh: THREE.Mesh; cx: number; cz: number; lod: number; geos: (THREE.BufferGeometry | null)[]; center: THREE.Vector3 }[] = [];

  constructor(readonly hf: Heightfield, loader: THREE.TextureLoader) {
    super();
    this.material = this.makeMaterial(loader);
    const half = WORLD_SIZE / 2;
    for (let j = 0; j < CHUNKS; j++) for (let i = 0; i < CHUNKS; i++) {
      const x0 = -half + i * CHUNK, z0 = -half + j * CHUNK;
      // Skip chunks entirely under water (the ocean is opaque).
      let maxH = -1e9;
      for (let zz = 0; zz <= 8; zz++) for (let xx = 0; xx <= 8; xx++)
        maxH = Math.max(maxH, hf.getHeight(x0 + xx * CHUNK / 8, z0 + zz * CHUNK / 8));
      if (maxH < -2) continue;
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = true;
      const c = { mesh, cx: x0, cz: z0, lod: -1, geos: LOD_SEGMENTS.map(() => null) as (THREE.BufferGeometry | null)[], center: new THREE.Vector3(x0 + CHUNK / 2, 0, z0 + CHUNK / 2) };
      this.chunks.push(c);
      this.add(mesh);
    }
  }

  private buildGeometry(x0: number, z0: number, seg: number): THREE.BufferGeometry {
    const hf = this.hf;
    const n = seg + 1;
    const step = CHUNK / seg;
    const stride = seg / EDGE_BASE;          // vertices per coarse anchor span
    const pos = new Float32Array(n * n * 3);
    const nor = new Float32Array(n * n * 3);
    const uv = new Float32Array(n * n * 2);
    const tmp = new THREE.Vector3();

    // Height of a border vertex, evaluated on the coarse anchor grid so that two
    // neighbouring chunks agree along their shared edge whatever their LOD.
    const anchored = (along: number, fixedX: number, fixedZ: number, horizontal: boolean) => {
      const a0 = Math.floor(along / stride) * stride;
      const a1 = Math.min(a0 + stride, seg);
      const t = a1 === a0 ? 0 : (along - a0) / (a1 - a0);
      const h0 = horizontal ? hf.getHeight(x0 + a0 * step, fixedZ) : hf.getHeight(fixedX, z0 + a0 * step);
      const h1 = horizontal ? hf.getHeight(x0 + a1 * step, fixedZ) : hf.getHeight(fixedX, z0 + a1 * step);
      return h0 + (h1 - h0) * t;
    };

    let p = 0, q = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = x0 + i * step, z = z0 + j * step;
        let h: number;
        if (j === 0 || j === seg) h = anchored(i, x, z, true);
        else if (i === 0 || i === seg) h = anchored(j, x, z, false);
        else h = hf.getHeight(x, z);
        pos[p] = x; pos[p + 1] = h; pos[p + 2] = z;
        hf.getNormal(x, z, tmp, step * 0.85);
        nor[p] = tmp.x; nor[p + 1] = tmp.y; nor[p + 2] = tmp.z;
        p += 3;
        uv[q++] = i / seg; uv[q++] = j / seg;
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  /** Pick LOD per chunk from camera distance. Cheap; call every frame. */
  update(camera: THREE.Camera) {
    const cp = camera.position;
    for (const c of this.chunks) {
      const dx = Math.max(Math.abs(cp.x - c.center.x) - CHUNK / 2, 0);
      const dz = Math.max(Math.abs(cp.z - c.center.z) - CHUNK / 2, 0);
      const d = Math.hypot(dx, dz);
      let lod = LOD_SEGMENTS.length - 1;
      for (let l = 0; l < LOD_DISTANCE.length; l++) if (d < LOD_DISTANCE[l]) { lod = l; break; }
      if (lod !== c.lod) {
        if (!c.geos[lod]) c.geos[lod] = this.buildGeometry(c.cx, c.cz, LOD_SEGMENTS[lod]);
        c.mesh.geometry = c.geos[lod]!;
        c.lod = lod;
      }
    }
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

    // Macro variation noise texture (CPU generated, tileable enough at this frequency).
    const N = 256, data = new Uint8Array(N * N * 4), noise = new SimplexNoise(77);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2, b = (j / N) * Math.PI * 2; // tileable via 4D-ish trick on a torus
      const v = noise.fbm2D(Math.cos(a) * 1.7 + Math.sin(b) * 0.9, Math.sin(a) * 1.7 + Math.cos(b) * 1.3, 4) * 0.5 + 0.5;
      const k = (j * N + i) * 4; data[k] = data[k + 1] = data[k + 2] = Math.floor(v * 255); data[k + 3] = 255;
    }
    const macro = new THREE.DataTexture(data, N, N); macro.wrapS = macro.wrapT = THREE.RepeatWrapping; macro.needsUpdate = true;

    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
    const uniforms = {
      tGrassD: { value: grass.D }, tGrassN: { value: grass.N },
      tForestD: { value: forest.D }, tForestN: { value: forest.N },
      tCliffD: { value: cliff.D }, tCliffN: { value: cliff.N },
      tSandD: { value: sand.D }, tSandN: { value: sand.N },
      tScreeD: { value: scree.D }, tScreeN: { value: scree.N },
      tMacro: { value: macro }, uSeaLevel: { value: 0 }, uGroundLift: { value: 1.45 },
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
