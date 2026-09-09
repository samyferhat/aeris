import * as THREE from 'three';
import { Heightfield, WORLD_SIZE } from './Heightfield';
import { applyAerialPerspective } from '../sky/AerialPerspective';
import terrainChunk from '../shaders/terrain.glsl?raw';
import { SimplexNoise } from '../core/Noise';

const CHUNKS = 24;                       // chunks per side
const CHUNK = WORLD_SIZE / CHUNKS;       // 375 m
const LOD_SEGMENTS = [64, 32, 16, 8];
const LOD_DISTANCE = [900, 2200, 4500];  // switch distances (chunk centre)
const SKIRT = 40;

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
      const c = { mesh, cx: x0, cz: z0, lod: -1, geos: [null, null, null, null] as (THREE.BufferGeometry | null)[], center: new THREE.Vector3(x0 + CHUNK / 2, 0, z0 + CHUNK / 2) };
      this.chunks.push(c);
      this.add(mesh);
    }
  }

  private buildGeometry(x0: number, z0: number, seg: number): THREE.BufferGeometry {
    const hf = this.hf;
    const n = seg + 1;
    const nSk = n + 2; // with skirt ring
    const step = CHUNK / seg;
    const pos = new Float32Array(nSk * nSk * 3);
    const nor = new Float32Array(nSk * nSk * 3);
    const uv = new Float32Array(nSk * nSk * 2);
    const tmp = new THREE.Vector3();
    let p = 0, q = 0;
    for (let j = 0; j < nSk; j++) for (let i = 0; i < nSk; i++) {
      const gi = Math.min(Math.max(i - 1, 0), seg), gj = Math.min(Math.max(j - 1, 0), seg);
      const x = x0 + gi * step, z = z0 + gj * step;
      const skirt = (i === 0 || j === 0 || i === nSk - 1 || j === nSk - 1);
      const h = hf.getHeight(x, z) - (skirt ? SKIRT : 0);
      pos[p] = x; pos[p + 1] = h; pos[p + 2] = z;
      hf.getNormal(x, z, tmp);
      nor[p] = tmp.x; nor[p + 1] = tmp.y; nor[p + 2] = tmp.z;
      p += 3;
      uv[q++] = gi / seg; uv[q++] = gj / seg;
    }
    const idx: number[] = [];
    for (let j = 0; j < nSk - 1; j++) for (let i = 0; i < nSk - 1; i++) {
      const a = j * nSk + i, b = a + 1, c = a + nSk, d = c + 1;
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
      let lod = 3;
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
    const grass = set('grass'), forest = set('forest'), cliff = set('cliff'), sand = set('sand');

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
      tMacro: { value: macro }, uSeaLevel: { value: 0 },
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
