import * as THREE from 'three';
import { Heightfield, WORLD_SIZE } from './Heightfield';
import { applyAerialPerspective } from '../sky/AerialPerspective';
import { makeLeafCluster, makeBark } from './Foliage';
import { mulberry32, SimplexNoise, smoothstep, clamp } from '../core/Noise';

const CHUNK = 380;            // metres per vegetation chunk
const RADIUS = 6;             // chunks around the camera
const SPACING = 6.2;          // metres between candidate trees on the jittered grid
const NEAR_DIST = 780;        // full 3D trees inside this range
const FAR_DIST = 2500;        // billboards out to here
const BUILD_BUDGET = 3;       // chunks built per frame; the rest wait in the queue

/**
 * Instanced vegetation streamed around the camera.
 *
 * Two representations share one scatter: crossed foliage cards + trunk close in, a
 * single camera-facing card further out. Placement matches the forest weight used by
 * the terrain shader, so the 3D trees always sit on ground that is already textured as
 * forest. Everything sways with a wind field driven in the vertex shader.
 */
export class Vegetation extends THREE.Group {
  private treeGeo: THREE.BufferGeometry;
  private billboardGeo: THREE.BufferGeometry;
  private treeMat: THREE.MeshStandardMaterial;
  private billboardMat: THREE.MeshStandardMaterial;
  private chunks = new Map<string, { near: THREE.InstancedMesh; far: THREE.InstancedMesh; count: number } | null>();
  /**
   * Chunks waiting to be built. A chunk costs a few milliseconds, and crossing a
   * boundary at three hundred knots asks for a couple of dozen at once; done in the
   * frame they are asked for, that is a visible stutter every second and a half.
   */
  private queue: [number, number][] = [];
  private noise = new SimplexNoise(77);
  private time = { value: 0 };
  private windStrength = { value: 1.0 };
  private lastCx = 1e9; private lastCz = 1e9;

  constructor(private hf: Heightfield) {
    super();
    const leaf = makeLeafCluster(5, 512);
    const crown = makeLeafCluster(11, 512, true);
    const bark = makeBark(9, 256);
    this.treeMat = this.makeFoliageMaterial(leaf.map, leaf.normal, false);
    this.billboardMat = this.makeFoliageMaterial(crown.map, crown.normal, true);
    this.treeGeo = this.buildTreeGeometry(bark.map);
    this.billboardGeo = this.buildBillboardGeometry();
    this.frustumCulled = false;
  }

  /** Foliage/trunk material: alpha-tested, two-sided, wind-swayed, aerial-perspective aware. */
  private makeFoliageMaterial(map: THREE.Texture, normalMap: THREE.Texture, billboard: boolean) {
    const mat = new THREE.MeshStandardMaterial({
      map, normalMap, alphaTest: billboard ? 0.42 : 0.36, side: THREE.DoubleSide,
      roughness: 0.86, metalness: 0.0, color: 0x9ab27a, vertexColors: !billboard,
    });
    mat.normalScale.set(0.7, 0.7);
    (mat as any)._apKey = billboard ? 'vegBillboard' : 'vegTree';
    applyAerialPerspective(mat, (shader) => {
      shader.uniforms.uTime = this.time;
      shader.uniforms.uWind = this.windStrength;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vLeafTint;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vec3(vLeafTint * 0.94, vLeafTint, vLeafTint * 0.86);');
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          uniform float uTime; uniform float uWind;
          attribute float aSway;      // 0 at the trunk base, 1 at the canopy tips
          attribute float aPhase;
          varying float vLeafTint;
          // Every instance shares one geometry and one texture, so without a per-instance
          // variation a forest of them reads as a repeated stroke — the eye picks the
          // shape out immediately and the hillside looks hatched. The instance's own
          // position is the only thing that differs, so it is what the variation is
          // hashed from: which way round the card is, and how dark its leaves are.
          float leafHash(vec3 p) { return fract(sin(dot(p.xz, vec2(12.9898, 78.233))) * 43758.5453); }`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 instOrigin = instanceMatrix[3].xyz;
          #else
            vec3 instOrigin = vec3(0.0);
          #endif
          float lh = leafHash(instOrigin);
          vLeafTint = 0.72 + 0.52 * fract(lh * 7.31);
          ${billboard ? `
          // Camera-facing card, rebuilt around the instance origin.
          //
          // Facing only about the vertical axis is the usual choice and it is wrong for
          // an aeroplane: a vertical card looked down on from a thousand feet projects
          // to a sliver, and a hillside of them reads as hatching rather than as trees.
          // Tilting the card to face the camera fully turns each one back into a crown
          // seen from above, which is what a canopy looks like from up there.
          vec3 camDir = normalize(cameraPosition - (modelMatrix * vec4(instOrigin, 1.0)).xyz);
          vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), camDir));
          vec3 upv = normalize(cross(camDir, right));
          float cw = 0.72 + 0.62 * fract(lh * 3.7);
          transformed = right * (position.x * cw) + upv * (position.y - 4.6) + vec3(0.0, 4.6, 0.0);
          ` : ''}
          {
            float t = uTime;
            float ph = aPhase * 6.2831;
            // Two-frequency sway: a slow trunk bend plus a faster leaf flutter.
            float gust = 0.55 + 0.45 * sin(t * 0.21 + instOrigin.x * 0.003 + instOrigin.z * 0.0021);
            float bend = sin(t * 0.9 + ph) * 0.45 + sin(t * 1.7 + ph * 1.7) * 0.22;
            float flutter = sin(t * 4.3 + ph * 3.1) * 0.16;
            float amp = aSway * aSway * uWind * gust;
            transformed.x += (bend + flutter) * amp * 0.9;
            transformed.z += (bend * 0.6 - flutter * 0.5) * amp * 0.9;
            transformed.y -= abs(bend) * amp * 0.18;
          }
          #ifdef USE_INSTANCING
            // Mirror half the cards. One bit, and the hatching is gone.
            if (fract(lh * 19.7) > 0.5) {
              #ifdef USE_MAP
                vMapUv.x = 1.0 - vMapUv.x;
              #endif
              #ifdef USE_NORMALMAP
                vNormalMapUv.x = 1.0 - vNormalMapUv.x;
              #endif
            }
          #endif`);
    });
    return mat;
  }

  /** Trunk + three crossed foliage cards, merged into one geometry (~24 triangles). */
  private buildTreeGeometry(bark: THREE.Texture): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = [];
    // Trunk: tapered, 5 sides, uv mapped to the top-left of the atlas is wrong, so the
    // trunk uses the darkest corner of the leaf atlas — instead we tint it by vertex colour.
    const trunk = new THREE.CylinderGeometry(0.16, 0.34, 4.6, 5, 1, true);
    trunk.translate(0, 2.3, 0);
    parts.push(trunk);
    // Foliage cards, rotated around Y and tilted, sitting on top of the trunk.
    for (let i = 0; i < 3; i++) {
      const card = new THREE.PlaneGeometry(7.2, 7.6, 1, 1);
      card.translate(0, 5.6, 0);
      card.rotateY((i / 3) * Math.PI + 0.3);
      card.rotateZ((i - 1) * 0.12);
      parts.push(card);
    }
    // A flat top card so the canopy is not see-through from directly above.
    const top = new THREE.PlaneGeometry(6.4, 6.4, 1, 1);
    top.rotateX(-Math.PI / 2); top.translate(0, 7.1, 0);
    parts.push(top);

    const geo = mergeGeometries(parts);
    const pos = geo.getAttribute('position');
    const uv = geo.getAttribute('uv');
    const sway = new Float32Array(pos.count);
    const phase = new Float32Array(pos.count);
    const color = new Float32Array(pos.count * 3);
    const trunkVerts = trunk.getAttribute('position').count;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      sway[i] = clamp((y - 1.0) / 6.5, 0, 1);
      phase[i] = (i % 17) / 17;
      const isTrunk = i < trunkVerts;
      if (isTrunk) {
        // Bark colour, and map the trunk to an opaque corner of the atlas.
        color[i * 3] = 0.30; color[i * 3 + 1] = 0.23; color[i * 3 + 2] = 0.16;
        uv.setXY(i, 0.5 + (uv.getX(i) - 0.5) * 0.06, 0.62 + (y / 4.6) * 0.1);
      } else {
        const v = 0.86 + ((i * 37) % 29) / 29 * 0.28;
        color[i * 3] = v * 0.95; color[i * 3 + 1] = v; color[i * 3 + 2] = v * 0.9;
      }
    }
    geo.setAttribute('aSway', new THREE.BufferAttribute(sway, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    geo.setAttribute('color', new THREE.BufferAttribute(color, 3));
    uv.needsUpdate = true;
    this.treeMatUsesVertexColor = true;
    return geo;
  }
  private treeMatUsesVertexColor = false;

  private buildBillboardGeometry(): THREE.BufferGeometry {
    const geo = new THREE.PlaneGeometry(8.0, 8.4, 1, 1);
    geo.translate(0, 4.6, 0);
    const pos = geo.getAttribute('position');
    const sway = new Float32Array(pos.count), phase = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) { sway[i] = clamp((pos.getY(i) - 1.0) / 7.0, 0, 1); phase[i] = (i % 7) / 7; }
    geo.setAttribute('aSway', new THREE.BufferAttribute(sway, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    return geo;
  }

  /**
   * Ground that has been built on. Anything installed on the terrain has to punch a
   * hole in the forest, or the trees grow straight through it — which is exactly what
   * a fuel farm with a pine coming out of the roof looks like.
   */
  readonly clearings: { x: number; z: number; r: number }[] = [];

  /** Same forest test as the terrain shader, so trees only grow where the ground is forest. */
  private forestDensity(x: number, z: number): number {
    const h = this.hf.getHeight(x, z);
    if (h < 6 || h > 820) return 0;
    for (const c of this.clearings) {
      const dx = x - c.x, dz = z - c.z;
      if (dx * dx + dz * dz < c.r * c.r) return 0;
    }
    const slope = this.hf.getSlope(x, z);
    if (slope > 0.48) return 0;
    // Kept in step with the forest weight in shaders/terrain.glsl: a tree that grows
    // on ground the shader has painted as meadow is a tree standing in a field.
    const macro = this.noise.fbm2D(x * 0.00035 * 6.2832, z * 0.00035 * 6.2832, 4) * 0.5 + 0.5;
    const macro2 = this.noise.fbm2D(x * 0.0021 * 6.2832 + 3, z * 0.0021 * 6.2832 + 1, 3) * 0.5 + 0.5;
    let d = smoothstep(0.16, 0.44, macro * 0.60 + macro2 * 0.40);
    d *= smoothstep(6, 30, h) * (1 - smoothstep(560, 820, h));
    d *= 1 - smoothstep(0.26, 0.46, slope);
    return d;
  }

  private buildChunk(cx: number, cz: number) {
    const key = `${cx},${cz}`;
    if (this.chunks.has(key)) return;
    const rnd = mulberry32(((cx & 0xffff) << 16) ^ (cz & 0xffff) ^ 0x9e37);
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    const mats: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), pos = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0), nrm = new THREE.Vector3();
    // A jittered grid rather than uniform random: random scatter clumps and leaves
    // holes at exactly the scale a canopy should be closed at.
    const N = Math.round(CHUNK / SPACING);
    for (let gi = 0; gi < N * N; gi++) {
      const x = x0 + ((gi % N) + rnd()) * (CHUNK / N);
      const z = z0 + ((gi / N | 0) + rnd()) * (CHUNK / N);
      const d = this.forestDensity(x, z);
      if (d <= 0.02 || rnd() > d) continue;
      const y = this.hf.getHeight(x, z);
      if (y < 5) continue;
      const scale = 0.75 + rnd() * rnd() * 1.35;
      // Lean slightly with the slope, keep a random heading.
      this.hf.getNormal(x, z, nrm);
      q.setFromUnitVectors(up, nrm.clone().lerp(up, 0.6).normalize());
      q.multiply(new THREE.Quaternion().setFromAxisAngle(up, rnd() * Math.PI * 2));
      s.set(scale * (0.85 + rnd() * 0.3), scale, scale * (0.85 + rnd() * 0.3));
      pos.set(x, y - 0.35, z);
      mats.push(m.compose(pos, q, s).clone());
    }
    if (mats.length === 0) { this.chunks.set(key, null); return; }
    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
      const inst = new THREE.InstancedMesh(geo, mat, mats.length);
      mats.forEach((mm, i) => inst.setMatrixAt(i, mm));
      inst.instanceMatrix.needsUpdate = true;
      inst.castShadow = true; inst.receiveShadow = true;
      inst.frustumCulled = true;
      inst.boundingSphere = new THREE.Sphere(new THREE.Vector3(x0 + CHUNK / 2, this.hf.getHeight(x0 + CHUNK / 2, z0 + CHUNK / 2) + 10, z0 + CHUNK / 2), CHUNK * 0.85 + 20);
      return inst;
    };
    const near = mk(this.treeGeo, this.treeMat);
    const far = mk(this.billboardGeo, this.billboardMat);
    far.castShadow = false;
    near.visible = false; far.visible = false;
    this.add(near, far);
    this.chunks.set(key, { near, far, count: mats.length });
  }

  update(camera: THREE.Camera, dt: number, windStrength = 1) {
    this.time.value += dt;
    this.windStrength.value = windStrength;
    const cx = Math.round(camera.position.x / CHUNK), cz = Math.round(camera.position.z / CHUNK);
    if (cx !== this.lastCx || cz !== this.lastCz) {
      this.lastCx = cx; this.lastCz = cz;
      // Drop chunks that fell out of range so memory stays bounded.
      for (const [key, entry] of this.chunks) {
        const [kx, kz] = key.split(',').map(Number);
        if (Math.abs(kx - cx) > RADIUS + 1 || Math.abs(kz - cz) > RADIUS + 1) {
          if (entry) { this.remove(entry.near, entry.far); entry.near.dispose(); entry.far.dispose(); }
          this.chunks.delete(key);
        }
      }
      // Nearest first, so what is about to be flown over exists before the far edge.
      this.queue.length = 0;
      for (let j = -RADIUS; j <= RADIUS; j++) for (let i = -RADIUS; i <= RADIUS; i++) {
        if (!this.chunks.has(`${cx + i},${cz + j}`)) this.queue.push([cx + i, cz + j]);
      }
      this.queue.sort((a, b) => (Math.abs(a[0] - cx) + Math.abs(a[1] - cz)) - (Math.abs(b[0] - cx) + Math.abs(b[1] - cz)));
    }
    for (let n = 0; n < BUILD_BUDGET && this.queue.length; n++) {
      const [qx, qz] = this.queue.shift()!;
      this.buildChunk(qx, qz);
    }
    // Pick the representation per chunk from its distance to the camera.
    for (const [key, entry] of this.chunks) {
      if (!entry) continue;
      const [kx, kz] = key.split(',').map(Number);
      const dx = (kx + 0.5) * CHUNK - camera.position.x, dz = (kz + 0.5) * CHUNK - camera.position.z;
      const d = Math.hypot(dx, dz);
      entry.near.visible = d < NEAR_DIST;
      entry.far.visible = d >= NEAR_DIST && d < FAR_DIST;
    }
  }

  get materials() { return [this.treeMat, this.billboardMat]; }
}

/** Minimal geometry merge (position/normal/uv only) so we do not pull in BufferGeometryUtils. */
function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let vCount = 0, iCount = 0;
  for (const g of geos) { vCount += g.getAttribute('position').count; iCount += g.index ? g.index.count : g.getAttribute('position').count; }
  const position = new Float32Array(vCount * 3), normal = new Float32Array(vCount * 3), uv = new Float32Array(vCount * 2);
  const index = new Uint16Array(iCount);
  let vo = 0, io = 0;
  for (const g of geos) {
    const p = g.getAttribute('position'), n = g.getAttribute('normal'), u = g.getAttribute('uv');
    position.set(p.array as Float32Array, vo * 3);
    normal.set(n.array as Float32Array, vo * 3);
    uv.set(u.array as Float32Array, vo * 2);
    const idx = g.index;
    if (idx) for (let i = 0; i < idx.count; i++) index[io++] = idx.getX(i) + vo;
    else for (let i = 0; i < p.count; i++) index[io++] = i + vo;
    vo += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(position, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingSphere();
  return out;
}
