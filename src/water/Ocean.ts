import * as THREE from 'three';
import { Heightfield, WORLD_SIZE } from '../world/Heightfield';
import { applyAerialPerspective } from '../sky/AerialPerspective';
import oceanChunk from '../shaders/ocean.glsl?raw';
import { SimplexNoise } from '../core/Noise';

const NEAR_SIZE = 5000, NEAR_SEGS = 360, FAR_SIZE = 120000;

export class Ocean extends THREE.Group {
  readonly material: THREE.MeshStandardMaterial;
  private near: THREE.Mesh;
  private far: THREE.Mesh;
  private uniforms: Record<string, THREE.IUniform>;

  constructor(hf: Heightfield) {
    super();
    this.uniforms = {
      uTime: { value: 0 },
      tHeight: { value: hf.texture },
      uWorldSize: { value: WORLD_SIZE },
      tDetailN: { value: Ocean.makeDetailNormal() },
      tFoam: { value: Ocean.makeFoam() },
      uWaveScale: { value: 1.0 },
      uShallowColor: { value: new THREE.Color(0x2aa8a4).convertSRGBToLinear() },
      uDeepColor: { value: new THREE.Color(0x06304f).convertSRGBToLinear() },
      uSandColor: { value: new THREE.Color(0xb9a77a).convertSRGBToLinear() },
    };
    this.material = this.makeMaterial();
    const nearGeo = new THREE.PlaneGeometry(NEAR_SIZE, NEAR_SIZE, NEAR_SEGS, NEAR_SEGS);
    nearGeo.rotateX(-Math.PI / 2);
    this.near = new THREE.Mesh(nearGeo, this.material);
    this.near.frustumCulled = false;
    this.near.receiveShadow = true;
    const farGeo = new THREE.RingGeometry(NEAR_SIZE * 0.49, FAR_SIZE, 64, 8);
    farGeo.rotateX(-Math.PI / 2);
    this.far = new THREE.Mesh(farGeo, this.material);
    this.far.frustumCulled = false;
    this.add(this.near, this.far);
  }

  update(dt: number, camera: THREE.Camera) {
    this.uniforms.uTime.value += dt;
    const cell = NEAR_SIZE / NEAR_SEGS;
    this.near.position.set(Math.round(camera.position.x / cell) * cell, 0, Math.round(camera.position.z / cell) * cell);
    this.far.position.set(camera.position.x, 0, camera.position.z);
  }

  private makeMaterial(): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.12, metalness: 0.0, envMapIntensity: 1.0 });
    (mat as any)._apKey = 'ocean';
    applyAerialPerspective(mat, (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n' + oceanChunk)
        .replace('#include <begin_vertex>', `
          vec3 wp0 = (modelMatrix * vec4(position, 1.0)).xyz;
          float camDist = length(wp0.xz - cameraPosition.xz);
          // Bend the sea down with the curvature of the earth. Without this the flat
          // plane reaches exactly eye level and paints a bright strip over the band of
          // sky the atmosphere shader (which does use a round planet) expects to see.
          wp0.y -= camDist * camDist / (2.0 * 6371000.0);
          vOFade = 1.0 - smoothstep(1500.0, 4000.0, camDist);
          vec3 oDisp, oN; float oCrest;
          gerstner(wp0, uWaveScale * vOFade, oDisp, oN, oCrest);
          vec3 transformed = position + oDisp + vec3(0.0, wp0.y - (modelMatrix * vec4(position, 1.0)).y, 0.0);
          vOWaveNormal = mix(vec3(0.0, 1.0, 0.0), oN, vOFade);
          vOCrest = oCrest;
          vOWorldPos = wp0 + oDisp;`)
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + oceanChunk)
        .replace('#include <map_fragment>', `
          vec3 P = vOWorldPos;
          float dist = length(P - cameraPosition);
          float detailFade = 1.0 - smoothstep(300.0, 2500.0, dist);
          vec2 uvA = P.xz * 0.045 + vec2(uTime * 0.021, uTime * 0.013);
          vec2 uvB = P.xz * 0.11 * mat2(0.6, 0.8, -0.8, 0.6) + vec2(-uTime * 0.03, uTime * 0.017);
          vec2 uvC = P.xz * 0.008 + vec2(uTime * 0.004, -uTime * 0.006);
          vec3 dn = (texture2D(tDetailN, uvA).rgb * 2.0 - 1.0) + (texture2D(tDetailN, uvB).rgb * 2.0 - 1.0) * 0.6 + (texture2D(tDetailN, uvC).rgb * 2.0 - 1.0) * 0.8;
          vec3 wN = normalize(vOWaveNormal + vec3(dn.x, 0.0, dn.y) * 0.55 * detailFade);
          // Fade micro-normals with distance to reduce specular aliasing
          wN = normalize(mix(vec3(0.0, 1.0, 0.0), wN, mix(0.35, 1.0, detailFade)));
          // Water depth from the terrain heightfield (refraction stand-in)
          float depth = max(0.0, P.y - terrainHeightAt(P.xz));
          float shallow = exp(-depth * 0.09);
          float veryShallow = exp(-depth * 0.35);
          vec3 waterCol = mix(uDeepColor, uShallowColor, shallow);
          waterCol = mix(waterCol, uSandColor * 0.7, veryShallow * 0.85);
          // Foam: shoreline, crests, breaking pattern
          float foamTex = texture2D(tFoam, P.xz * 0.06 + vec2(uTime * 0.02, 0.0)).r;
          float foamTex2 = texture2D(tFoam, P.xz * 0.025 - vec2(0.0, uTime * 0.015)).r;
          float shoreFoam = smoothstep(0.55, 0.95, (1.0 - smoothstep(0.0, 4.5, depth)) * (0.55 + 0.6 * foamTex) + 0.25 * sin(uTime * 0.9 - depth * 1.3) * (1.0 - smoothstep(0.0, 8.0, depth)));
          float crestFoam = smoothstep(0.78, 0.98, vOCrest * (0.7 + 0.5 * foamTex2)) * uWaveScale;
          float foam = clamp(shoreFoam + crestFoam, 0.0, 1.0) * detailFade;
          diffuseColor.rgb = mix(waterCol, vec3(0.85), foam);`)
        .replace('#include <normal_fragment_begin>', `
          float faceDirection = 1.0;
          vec3 normal = normalize(mat3(viewMatrix) * wN);
          vec3 nonPerturbedNormal = normal;`)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(roughness, 0.7, foam) + 0.35 * (1.0 - detailFade);')
        .replace('#include <opaque_fragment>', `
          // Sub-surface light: sun shining through wave crests when looking towards it.
          vec3 V = normalize(cameraPosition - P);
          float sss = pow(max(0.0, dot(V, -uSunDir + wN * 0.4)), 4.0) * vOCrest * (1.0 - foam) * 0.35 * uWaveScale;
          outgoingLight += uShallowColor * sss * uSunIntensity * 0.12 * max(0.0, uSunDir.y);
          #include <opaque_fragment>`);
    });
    return mat;
  }

  /** Procedural tileable normal map for small ripples. */
  static makeDetailNormal(): THREE.DataTexture {
    const N = 512, noise = new SimplexNoise(9), h = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2, b = (j / N) * Math.PI * 2;
      // sample on a torus for seamless tiling
      const x = Math.cos(a) * 2.2, y = Math.sin(a) * 2.2, z = Math.cos(b) * 2.2, w = Math.sin(b) * 2.2;
      let v = 0, amp = 1, f = 1;
      for (let o = 0; o < 5; o++) { v += amp * noise.noise3D(x * f + z * f * 0.7, y * f + w * f * 0.5, (z - y) * f); amp *= 0.5; f *= 2.1; }
      h[j * N + i] = v;
    }
    const data = new Uint8Array(N * N * 4);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const l = h[j * N + ((i - 1 + N) % N)], r = h[j * N + ((i + 1) % N)];
      const d = h[((j - 1 + N) % N) * N + i], u = h[((j + 1) % N) * N + i];
      const n = new THREE.Vector3((l - r) * 2.5, (d - u) * 2.5, 1).normalize();
      const k = (j * N + i) * 4;
      data[k] = (n.x * 0.5 + 0.5) * 255; data[k + 1] = (n.y * 0.5 + 0.5) * 255; data[k + 2] = (n.z * 0.5 + 0.5) * 255; data[k + 3] = 255;
    }
    const t = new THREE.DataTexture(data, N, N); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 8;
    return t;
  }

  static makeFoam(): THREE.DataTexture {
    const N = 256, noise = new SimplexNoise(31), data = new Uint8Array(N * N * 4);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2, b = (j / N) * Math.PI * 2;
      const x = Math.cos(a) * 1.5, y = Math.sin(a) * 1.5, z = Math.cos(b) * 1.5, w = Math.sin(b) * 1.5;
      let v = 0, amp = 1, f = 1;
      for (let o = 0; o < 4; o++) { v += amp * Math.abs(noise.noise3D(x * f + w * f, y * f + z * f * 0.6, (w - x) * f)); amp *= 0.55; f *= 2.3; }
      v = Math.pow(1 - Math.min(1, v * 0.9), 2.2);
      const k = (j * N + i) * 4; data[k] = data[k + 1] = data[k + 2] = v * 255; data[k + 3] = 255;
    }
    const t = new THREE.DataTexture(data, N, N); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
    return t;
  }
}
