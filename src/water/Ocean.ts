import * as THREE from 'three';
import { Heightfield, WORLD_SIZE } from '../world/Heightfield';
import { applyAerialPerspective } from '../sky/AerialPerspective';
import oceanChunk from '../shaders/ocean.glsl?raw';
import { SimplexNoise } from '../core/Noise';

// The near grid has to resolve the swell it displaces: below about four quads per
// wavelength a Gerstner wave stops being a wave and becomes a pattern aligned with the
// mesh. At 11.7 m a quad, the two geometry components have seven and four.
const NEAR_SIZE = 6000, NEAR_SEGS = 512, FAR_SIZE = 140000;

/**
 * The sea: one material on two meshes — a displaced grid that follows the camera, and a
 * ring that carries the same shading out to the horizon.
 *
 * Everything about how it looks lives in shaders/ocean.glsl. What is here is the
 * geometry, the noise the bottom is made of, and the wind.
 */
export class Ocean extends THREE.Group {
  readonly material: THREE.MeshStandardMaterial;
  private near: THREE.Mesh;
  private far: THREE.Mesh;
  readonly uniforms: Record<string, THREE.IUniform>;
  /** Direction the swell runs towards. The vegetation leans the same way. */
  readonly wind = new THREE.Vector2(0.83, 0.56).normalize();

  constructor(hf: Heightfield) {
    super();
    this.uniforms = {
      uTime: { value: 0 },
      tHeight: { value: hf.texture },
      uWorldSize: { value: WORLD_SIZE },
      tDetailN: { value: Ocean.makeDetailNormal() },
      tBed: { value: Ocean.makeBedNoise() },
      uWaveScale: { value: 1.0 },
      uWind: { value: this.wind },
      // Scattering colour of the water body. Deep water is this, and nothing else:
      // by thirty metres the extinction has removed everything the bottom sent back.
      uWaterTint: { value: new THREE.Color(0x0d4a60).convertSRGBToLinear() },
      uGlitter: { value: 0.42 },
      uWakeCount: { value: 0 },
      uWakeA: { value: Array.from({ length: 14 }, () => new THREE.Vector4()) },
      uWakeB: { value: Array.from({ length: 14 }, () => new THREE.Vector4()) },
    };
    this.material = this.makeMaterial();
    const nearGeo = new THREE.PlaneGeometry(NEAR_SIZE, NEAR_SIZE, NEAR_SEGS, NEAR_SEGS);
    nearGeo.rotateX(-Math.PI / 2);
    this.near = new THREE.Mesh(nearGeo, this.material);
    this.near.frustumCulled = false;
    this.near.receiveShadow = true;
    const farGeo = new THREE.RingGeometry(NEAR_SIZE * 0.49, FAR_SIZE, 128, 26);
    farGeo.rotateX(-Math.PI / 2);
    this.far = new THREE.Mesh(farGeo, this.material);
    this.far.frustumCulled = false;
    this.add(this.near, this.far);
  }

  /**
   * Hands the shader the list of things currently disturbing the surface. Kept as a
   * uniform array rather than a texture: there are never more than a dozen and the
   * fragment loop breaks out of it on the first empty slot.
   */
  setWakes(list: { x: number; z: number; dx: number; dz: number; beam: number; len: number; strength: number }[]) {
    const A = this.uniforms.uWakeA.value as THREE.Vector4[];
    const B = this.uniforms.uWakeB.value as THREE.Vector4[];
    const n = Math.min(list.length, A.length);
    for (let i = 0; i < n; i++) {
      const w = list[i];
      A[i].set(w.x, w.z, w.dx, w.dz);
      B[i].set(w.beam, w.len, w.strength, 0);
    }
    this.uniforms.uWakeCount.value = n;
  }

  update(dt: number, camera: THREE.Camera) {
    this.uniforms.uTime.value += dt;
    const cell = NEAR_SIZE / NEAR_SEGS;
    this.near.position.set(Math.round(camera.position.x / cell) * cell, 0, Math.round(camera.position.z / cell) * cell);
    this.far.position.set(camera.position.x, 0, camera.position.z);
  }

  private makeMaterial(): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.06, metalness: 0.0, envMapIntensity: 0.62 });
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
          // Beyond this the grid is coarser than the shortest wave, so the displacement
          // is faded out rather than sampled into aliasing.
          vOFade = 1.0 - smoothstep(1400.0, 2900.0, camDist);
          vODepth = max(0.0, -terrainHeightAt(wp0.xz));
          // Shoaling has to change slowly across the grid. Tied tightly to the depth
          // under each vertex it varies within one twenty-metre quad, the wave field
          // stops being continuous, and the lagoon fills with a visible checkerboard.
          float oShoal = smoothstep(0.4, 11.0, vODepth);
          float oShelter = shelterAt(wp0.xz);
          vOShelter = oShelter;
          vec3 oDisp, oN; float oCrest, oPhase;
          gerstner(wp0, uWaveScale * vOFade, oShoal, oShelter, oDisp, oN, oCrest, oPhase);
          // The surface may not go below the bottom. Without this the trough of a wave
          // dips under the reef crest and the terrain pokes through in triangles.
          oDisp.y = max(oDisp.y, (-vODepth + 0.12) - wp0.y);
          vec3 transformed = position + oDisp + vec3(0.0, wp0.y - (modelMatrix * vec4(position, 1.0)).y, 0.0);
          vOWaveNormal = mix(vec3(0.0, 1.0, 0.0), oN, vOFade);
          vOCrest = oCrest;
          vOPhase = oPhase;
          vOWorldPos = wp0 + oDisp;`)
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + oceanChunk)
        .replace('#include <map_fragment>', `
          vec3 P = vOWorldPos;
          vec3 V = normalize(cameraPosition - P);
          float dist = length(P - cameraPosition);
          float detailFade = 1.0 - smoothstep(420.0, 3400.0, dist);

          // ---- surface -----------------------------------------------------
          vec2 drift = uWind * uTime;
          vec2 uvA = P.xz * 0.052 + drift * 0.021;
          vec2 uvB = P.xz * 0.132 * mat2(0.6, 0.8, -0.8, 0.6) - drift * 0.033;
          vec2 uvC = P.xz * 0.0092 + drift * 0.0055;
          vec3 dn = (texture2D(tDetailN, uvA).rgb * 2.0 - 1.0)
                  + (texture2D(tDetailN, uvB).rgb * 2.0 - 1.0) * 0.55
                  + (texture2D(tDetailN, uvC).rgb * 2.0 - 1.0) * 0.85;
          // Ripples flatten as the water thins out, and everything here is taken from the
          // depth at the fragment rather than at the vertex, so the grid never shows.
          float depth = max(0.0, -terrainHeightAt(P.xz));
          float shoalF = smoothstep(0.4, 11.0, depth);
          float ripple = 0.52 * detailFade * mix(0.28, 1.0, smoothstep(0.25, 3.0, depth));
          // The chop: the four short components, as a slope, evaluated here.
          float chopFade = 1.0 - smoothstep(900.0, 5200.0, dist);
          vec2 slope = chopSlope(P.xz, uWaveScale, shoalF, vOShelter, chopFade);
          vec3 wN = normalize(vOWaveNormal + vec3(-slope.x, 0.0, -slope.y) * 0.85
                                           + vec3(dn.x, 0.0, dn.y) * ripple);
          wN = normalize(mix(vec3(0.0, 1.0, 0.0), wN, mix(0.55, 1.0, detailFade)));

          // ---- the bottom, seen through the surface -------------------------
          vec3 Rr = refract(-V, wN, 0.7463);              // air into water, n = 1.34
          float rdy = max(-Rr.y, 0.10);
          vec2 hit = P.xz + Rr.xz * (depth / rdy);
          hit = P.xz + Rr.xz * (max(0.0, -terrainHeightAt(hit)) / rdy);
          float under = max(0.0, -terrainHeightAt(hit));
          float pathDown = under / rdy;
          float e = 26.0;
          float sx = terrainHeightAt(hit + vec2(e, 0.0)) - terrainHeightAt(hit - vec2(e, 0.0));
          float sz = terrainHeightAt(hit + vec2(0.0, e)) - terrainHeightAt(hit - vec2(0.0, e));
          float bedSlope = 1.0 - 2.0 * e / sqrt(sx * sx + sz * sz + 4.0 * e * e);
          vec3 bed = seaFloorAlbedo(hit, under, bedSlope) * caustics(hit, under);
          // Down to the bottom with the sun, back up to the eye along the refracted ray.
          float sunPath = min(under / max(uSunDir.y, 0.22), 110.0);
          vec3 Tw = exp(-SIGMA * (pathDown + sunPath));
          vec3 body = bed * Tw + uWaterTint * (1.0 - Tw);

          // ---- surf ---------------------------------------------------------
          // Swell refracts as it shoals: by the time it breaks its crests are parallel
          // to the depth contours, whatever direction the wind sent it from. So the
          // phase of the surf is taken from the depth itself rather than from a bearing.
          // The lines then follow the reef exactly, and they run shorewards with time.
          float lateral = (texture2D(tBed, P.xz * 0.0021 + 0.13).b - 0.5) * 4.6;
          float surfPhase = uTime * 1.05 - depth * 1.30 + lateral;
          float crestBand = smoothstep(-0.10, 0.92, sin(surfPhase));
          float Hs = 1.55 * uWaveScale;
          // A wave breaks where the bottom comes up under it, not simply where the water
          // is shallow: without this second term the whole lagoon breaks at once and the
          // reef reads as a wide white field instead of a line.
          float depthSea = max(0.0, -terrainHeightAt(P.xz - uWind * 130.0));
          float rise = depthSea - depth;
          float breakZone = smoothstep(2.6 * Hs, 0.6 * Hs, depth) * smoothstep(0.35, 2.0, rise);
          float surf = breakZone * pow(crestBand, 2.0);
          // Whitewater keeps running shorewards after the wave has broken.
          float wash = smoothstep(0.75, 0.0, depth) * (0.25 + 0.75 * smoothstep(-0.7, 0.7, sin(surfPhase - 1.5)));
          // Whitecaps come in drifting patches, not on every crest, and the patches have
          // to be a field in their own right: hung on the wave phase they line up with
          // the mesh and read as a polka dot.
          float capField = texture2D(tBed, P.xz * 0.0034 - drift * 0.0017).r * 0.55
                         + texture2D(tBed, P.xz * 0.019 - drift * 0.0065).a * 0.45;
          float caps = smoothstep(0.62, 0.86, capField) * smoothstep(6.0, 20.0, depth)
                     * (1.0 - vOShelter) * uWaveScale * 0.55;
          // Three decorrelated scales of filament noise, multiplied in rather than added:
          // foam is torn, and a threshold on a smooth field gives a shape with an edge.
          float fn = texture2D(tBed, P.xz * 0.0085 + drift * 0.003).a * 0.42
                   + texture2D(tBed, P.xz * 0.041 - drift * 0.009).a * 0.34
                   + texture2D(tBed, P.xz * 0.155 + drift * 0.021).a * 0.24;
          float foam = smoothstep(0.34, 0.86, (surf * 1.2 + wash * 0.95 + caps * 0.9) * (0.20 + 1.50 * fn));
          foam *= mix(0.55, 1.0, detailFade);
          // Wakes on top: they are not surf and must not be thresholded with it, or a
          // boat in a calm bay leaves nothing at all.
          float wake = wakeFoam(P.xz) * (0.45 + 0.75 * fn) * detailFade;
          foam = clamp(foam + wake, 0.0, 1.0);

          // Fresnel takes the body colour away as the view goes grazing, which is when
          // the sky reflection is all there is left of the sea.
          float ndv = max(dot(wN, V), 0.02);
          float Fw = 0.021 + 0.979 * pow(1.0 - ndv, 5.0);
          diffuseColor.rgb = mix(body * (1.0 - Fw), vec3(0.70, 0.74, 0.76), foam);`)
        .replace('#include <normal_fragment_begin>', `
          float faceDirection = 1.0;
          vec3 normal = normalize(mat3(viewMatrix) * wN);
          vec3 nonPerturbedNormal = normal;`)
        .replace('#include <roughnessmap_fragment>', `
          // Roughness grows with distance because a pixel a kilometre away holds a whole
          // distribution of wave slopes; that is what draws the sun's glittering path.
          float roughnessFactor = mix(0.045, 0.19, 1.0 - detailFade) + 0.55 * foam;`)
        .replace('#include <opaque_fragment>', `
          // Sun through the back of a crest: the green translucence of a wave about to break.
          float sss = pow(max(0.0, dot(V, -uSunDir + wN * 0.45)), 4.0) * vOCrest
                    * (1.0 - foam) * uWaveScale * smoothstep(1.5, 8.0, depth);
          outgoingLight += uWaterTint * vec3(0.9, 2.2, 1.7) * sss * uSunIntensity * 0.030 * max(0.0, uSunDir.y);
          // The glittering path. A pixel of distant sea holds a whole distribution of
          // wave slopes, so the sun's reflection in it is not a point but a road drawn
          // towards the viewer: one GGX lobe whose width grows with the pixel footprint.
          vec3 Hv = normalize(V + uSunDir);
          float ndh = max(dot(wN, Hv), 0.0);
          // Near the aircraft a very sharp lobe puts one enormous sparkle in every
          // other pixel and bloom turns the lot into snow; the path the eye wants is a
          // far-field effect, so the lobe widens and the strength falls as it closes in.
          float ag = mix(0.115, 0.165, 1.0 - detailFade) + 0.45 * foam;
          float a2 = ag * ag;
          float den = ndh * ndh * (a2 - 1.0) + 1.0;
          float ggx = a2 / (PI * den * den);
          outgoingLight += uSunTransmit * uSunIntensity * Fw * ggx * uGlitter
                         * mix(0.26, 1.0, 1.0 - detailFade)
                         * smoothstep(-0.02, 0.12, uSunDir.y) * (1.0 - foam * 0.7);
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

  /**
   * Everything the bottom and the surf are made of, in four channels of one texture:
   * where the coral grows, where the seagrass grows, the smooth field the caustic net
   * is differenced out of, and the high-frequency field that breaks the foam lines up
   * so they never read as a repeating scallop.
   */
  static makeBedNoise(): THREE.DataTexture {
    const N = 512, data = new Uint8Array(N * N * 4);
    const na = new SimplexNoise(31), nb = new SimplexNoise(77), nc = new SimplexNoise(151), nd = new SimplexNoise(211);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2, b = (j / N) * Math.PI * 2;
      const x = Math.cos(a) * 1.6, y = Math.sin(a) * 1.6, z = Math.cos(b) * 1.6, w = Math.sin(b) * 1.6;
      const oct = (n: SimplexNoise, o: number, gain: number) => {
        let v = 0, amp = 1, f = 1, norm = 0;
        for (let k = 0; k < o; k++) { v += amp * n.noise3D(x * f + w * f * 0.6, y * f + z * f * 0.8, (z - x) * f); norm += amp; amp *= gain; f *= 2.15; }
        return v / norm * 0.5 + 0.5;
      };
      const k = (j * N + i) * 4;
      data[k] = oct(na, 4, 0.55) * 255;
      data[k + 1] = oct(nb, 4, 0.5) * 255;
      data[k + 2] = oct(nc, 3, 0.45) * 255;
      // Ridged: the foam breakup wants filaments, not blobs.
      data[k + 3] = Math.pow(1 - Math.abs(oct(nd, 4, 0.5) * 2 - 1), 1.6) * 255;
    }
    const t = new THREE.DataTexture(data, N, N);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4;
    return t;
  }
}
