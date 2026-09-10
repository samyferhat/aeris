import * as THREE from 'three';
import { Heightfield, WORLD_SIZE } from '../world/Heightfield';
import { HEAT_LAYER } from './Afterburner';
import { atmoUniforms } from '../sky/Atmosphere';

/**
 * Two things that only exist at a distance.
 *
 * Rain squalls: a tropical shower is a few kilometres across and you nearly always see
 * it from outside — a dark, streaked column hanging under one cloud with sunshine either
 * side of it. Modelled as exactly that, three or four cylinders drifting downwind, which
 * costs a dozen triangles and does more for the weather than any amount of particles.
 *
 * Heat shimmer: hot ground at midday bends the light passing over it, so the far end of
 * an island wobbles while the near end does not. That is a property of the air between
 * you and the ground, so it is drawn as a sheet of air at low level rather than as an
 * effect on the ground itself, and it distorts whatever is seen through it.
 */

const CELLS = 4;

export class Weather extends THREE.Group {
  private rain: THREE.InstancedMesh;
  private rainMat: THREE.ShaderMaterial;
  private cells: { x: number; z: number; r: number; strength: number }[] = [];
  private shimmer: THREE.Mesh;
  private shimmerMat: THREE.ShaderMaterial;
  private t = 0;
  /** 0 = dry, 1 = squalls about. Driven from the cloud coverage. */
  amount = 0.55;

  constructor(private hf: Heightfield, cloudBase: number) {
    super();
    this.frustumCulled = false;

    // ---- squalls ----------------------------------------------------------
    const H = cloudBase - 40;
    const geo = new THREE.CylinderGeometry(1, 0.72, 1, 18, 1, true);
    geo.translate(0, -0.5, 0);
    this.rainMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
      uniforms: {
        uTime: { value: 0 }, uAmount: { value: 1 },
        uTint: { value: new THREE.Color(0.16, 0.18, 0.22) },
        ...atmoUniforms,
      },
      vertexShader: `
        varying vec3 vW; varying vec2 vUvR; varying float vT;
        attribute float aSeed;
        void main() {
          vUvR = uv; vT = aSeed;
          vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: `
        #include <atmosphere>
        uniform float uTime; uniform float uAmount; uniform vec3 uTint;
        varying vec3 vW; varying vec2 vUvR; varying float vT;
        float h21(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
        void main() {
          // Streaks: a column of falling stripes, sheared by the wind as it descends.
          float y = vUvR.y;
          float sh = (1.0 - y) * 0.35;
          float s = h21(floor(vec2(vUvR.x * 240.0 + sh * 40.0, y * 6.0 - uTime * 3.2)));
          float streak = 0.55 + 0.45 * s;
          // Dense at the cloud base, ragged and evaporating before it reaches the ground.
          float body = smoothstep(0.02, 0.22, y) * smoothstep(1.0, 0.55, y);
          // A squall is a thing you look at from outside. Close up it is a windscreen
          // effect, which this is not, so it fades out rather than filling the frame.
          float a = body * streak * 0.46 * uAmount
                  * smoothstep(300.0, 1100.0, length(vW - cameraPosition));
          vec3 c = uTint * (0.42 + 0.55 * max(uSunDir.y, 0.0));
          c = aerialPerspective(c, vW, cameraPosition);
          gl_FragColor = vec4(c, a);
        }`,
    });
    this.rain = new THREE.InstancedMesh(geo, this.rainMat, CELLS);
    const seeds = new Float32Array(CELLS);
    for (let i = 0; i < CELLS; i++) seeds[i] = i / CELLS;
    this.rain.geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    this.rain.frustumCulled = false;
    this.rain.renderOrder = 5;
    this.add(this.rain);
    for (let i = 0; i < CELLS; i++) {
      this.cells.push({
        x: (Math.random() * 2 - 1) * WORLD_SIZE * 0.35,
        z: (Math.random() * 2 - 1) * WORLD_SIZE * 0.35,
        r: 500 + Math.random() * 900,
        strength: 0.4 + Math.random() * 0.6,
      });
    }
    this.rainHeight = H;

    // ---- heat shimmer ------------------------------------------------------
    // The sheet is written to the distortion buffer, not to the picture: its rgb is a
    // screen-space offset, so everything behind it wobbles and it is itself invisible.
    const sheet = new THREE.PlaneGeometry(9000, 9000, 1, 1).rotateX(-Math.PI / 2);
    this.shimmerMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.NormalBlending,
      uniforms: {
        uTime: { value: 0 }, tHeight: { value: hf.texture },
        uWorldSize: { value: WORLD_SIZE }, uStrength: { value: 0 },
      },
      vertexShader: `
        varying vec3 vW;
        void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `
        uniform float uTime; uniform sampler2D tHeight; uniform float uWorldSize; uniform float uStrength;
        varying vec3 vW;
        float n2(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = fract(sin(dot(i, vec2(12.9898, 78.233))) * 43758.5453);
          float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(12.9898, 78.233))) * 43758.5453);
          float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(12.9898, 78.233))) * 43758.5453);
          float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(12.9898, 78.233))) * 43758.5453);
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }
        void main() {
          float ground = texture2D(tHeight, vW.xz / uWorldSize + 0.5).r;
          // Only over sun-warmed land, and only over the low ground where the air stands.
          float land = smoothstep(2.0, 40.0, ground) * (1.0 - smoothstep(220.0, 520.0, ground));
          float amp = land * uStrength;
          if (amp < 0.002) discard;
          vec2 p = vW.xz * 0.011;
          float t = uTime * 0.9;
          vec2 d = vec2(n2(p + vec2(t, 0.0)) - 0.5, n2(p.yx * 1.31 - vec2(0.0, t * 1.3)) - 0.5);
          d += vec2(n2(p * 3.7 + t * 2.1) - 0.5, n2(p.yx * 4.1 - t * 1.7) - 0.5) * 0.45;
          gl_FragColor = vec4(d * amp, 0.0, amp);
        }`,
    });
    this.shimmer = new THREE.Mesh(sheet, this.shimmerMat);
    this.shimmer.layers.set(HEAT_LAYER);
    this.shimmer.frustumCulled = false;
    this.add(this.shimmer);
  }

  private rainHeight = 900;

  update(dt: number, camera: THREE.Camera, hour: number, wind: THREE.Vector2) {
    this.t += dt;
    this.rainMat.uniforms.uTime.value = this.t;
    this.rainMat.uniforms.uAmount.value = this.amount;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    const half = WORLD_SIZE * 0.5;
    for (let i = 0; i < CELLS; i++) {
      const c = this.cells[i];
      c.x += wind.x * 3.2 * dt;
      c.z += wind.y * 3.2 * dt;
      if (c.x > half) c.x -= WORLD_SIZE;
      if (c.x < -half) c.x += WORLD_SIZE;
      if (c.z > half) c.z -= WORLD_SIZE;
      if (c.z < -half) c.z += WORLD_SIZE;
      this.rain.setMatrixAt(i, m.compose(
        new THREE.Vector3(c.x, this.rainHeight, c.z), q,
        new THREE.Vector3(c.r, this.rainHeight - 60, c.r)));
    }
    this.rain.instanceMatrix.needsUpdate = true;
    this.rain.visible = this.amount > 0.02;

    // Shimmer: strongest in the early afternoon, gone by evening, absent at night.
    const midday = Math.max(0, 1 - Math.abs(hour - 14) / 4.5);
    this.shimmerMat.uniforms.uTime.value = this.t;
    // A couple of pixels, not thirty. Heat shimmer is something you notice on the far
    // end of a runway, not something that melts an island.
    this.shimmerMat.uniforms.uStrength.value = midday * midday * 0.085;
    // The sheet is the air just above the ground, so it sits at low level and follows
    // the camera; looking across it is what makes the far end of an island wobble.
    this.shimmer.position.set(camera.position.x, 26, camera.position.z);
    this.shimmer.visible = midday > 0.05;
  }
}
