import * as THREE from 'three';
import { HEAT_LAYER } from '../fx/Afterburner';

/**
 * Everything a weapon makes you look at.
 *
 * Five pools, each with the primitive that suits it and nothing else:
 *   smoke   — camera-facing points, shaded as little spheres so a trail has volume
 *   sparks  — additive points, ballistic, for impacts and casings striking
 *   tracers — instanced quads stretched along the round's own path
 *   blasts  — instanced quads for flashes, fireballs and shock rings
 *   debris  — instanced boxes, thrown and bounced on the CPU
 * plus a small pool of real point lights, because a muzzle flash that does not light
 * the aircraft is a decal, and a fireball that does not light the ground is a sticker.
 *
 * Everything is preallocated and recycled. Firing a gun at fifteen hundred rounds a
 * minute is not the moment to be allocating.
 */

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();

// ---------------------------------------------------------------- smoke -----

const SMOKE_MAX = 7000;

const SMOKE_VERT = /* glsl */ `
attribute vec4 aData;      // age, life, radius0, growth
attribute vec3 aTint;
attribute float aSeed;
uniform float uPixelScale;
varying float vAge, vSeed, vOpacity;
varying vec3 vTint;
varying vec3 vViewPos;
void main() {
  float t = clamp(aData.x / aData.y, 0.0, 1.0);
  vAge = t; vSeed = aSeed; vTint = aTint;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mv.xyz;
  float r = aData.z + aData.w * t;
  // Fade in over the first instant, then out over the whole rest of the life, so a
  // trail thins with distance behind the missile instead of ending in a hard stub.
  vOpacity = smoothstep(0.0, 0.06, t) * (1.0 - t) * (1.0 - t);
  // A point primitive is clipped on its centre, so a sprite big enough to straddle the
  // near plane is drawn as a hard-edged trapezoid — a white wedge stuck to the aircraft.
  // Fading the last few metres costs one puff out of a thousand and removes it.
  vOpacity *= smoothstep(4.0, 17.0, -mv.z);
  gl_PointSize = clamp(r * 2.0 * uPixelScale / max(-mv.z, 1.0), 1.0, 620.0);
  gl_Position = projectionMatrix * mv;
}`;

const SMOKE_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uSunDirView;
uniform vec3 uSunColor;
uniform vec3 uSky;
varying float vAge, vSeed, vOpacity;
varying vec3 vTint;
varying vec3 vViewPos;
float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  // Break the disc up so a puff is a clump and not a ball bearing. The noise turns
  // with age, which is what stops a trail reading as a row of identical stamps.
  float a = vSeed * 6.283 + vAge * 0.8;
  vec2 rq = vec2(q.x * cos(a) - q.y * sin(a), q.x * sin(a) + q.y * cos(a));
  float n = vnoise(rq * 2.1 + vSeed * 17.0) * 0.55 + vnoise(rq * 5.3 + vSeed * 7.0) * 0.30;
  float edge = 1.0 - smoothstep(0.25, 1.0, r2 + (n - 0.42) * 0.55);
  float alpha = edge * vOpacity;
  if (alpha < 0.004) discard;
  // Treat the puff as a sphere: the fake normal gives a lit side and a shadow side,
  // which is the whole difference between smoke and a grey blob.
  vec3 nrm = vec3(q, sqrt(max(0.0, 1.0 - r2)));
  float lam = max(0.0, dot(nrm, uSunDirView));
  // A little wrap-around, because smoke scatters forward much more than it reflects.
  float wrap = max(0.0, dot(nrm, uSunDirView) * 0.5 + 0.5);
  vec3 col = vTint * (uSky * 0.55 + uSunColor * (0.35 * lam + 0.55 * wrap * wrap));
  gl_FragColor = vec4(col, alpha);
}`;

class SmokePool extends THREE.Points {
  private pos: Float32Array;
  private vel: Float32Array;
  private data: Float32Array;   // age, life, radius0, growth
  private extra: Float32Array;  // buoyancy, drag, unused, unused
  private head = 0;
  private mat: THREE.ShaderMaterial;

  constructor() {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(SMOKE_MAX * 3);
    const data = new Float32Array(SMOKE_MAX * 4);
    const tint = new Float32Array(SMOKE_MAX * 3);
    const seed = new Float32Array(SMOKE_MAX);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aData', new THREE.BufferAttribute(data, 4));
    g.setAttribute('aTint', new THREE.BufferAttribute(tint, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uPixelScale: { value: 1 },
        uSunDirView: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(1, 1, 1) },
        uSky: { value: new THREE.Color(0.4, 0.5, 0.7) },
      },
      vertexShader: SMOKE_VERT, fragmentShader: SMOKE_FRAG,
      transparent: true, depthWrite: false, blending: THREE.NormalBlending,
    });
    super(g, mat);
    this.pos = pos; this.data = data; this.mat = mat;
    this.vel = new Float32Array(SMOKE_MAX * 3);
    this.extra = new Float32Array(SMOKE_MAX * 4);
    this.frustumCulled = false;
    this.renderOrder = 18;
  }

  spawn(p: THREE.Vector3, v: THREE.Vector3, life: number, r0: number, growth: number,
        tint: THREE.Color, buoyancy = 0, drag = 1.4) {
    const i = this.head; this.head = (this.head + 1) % SMOKE_MAX;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    this.data[i * 4] = 0; this.data[i * 4 + 1] = life;
    this.data[i * 4 + 2] = r0; this.data[i * 4 + 3] = growth;
    this.extra[i * 4] = buoyancy; this.extra[i * 4 + 1] = drag;
    const tc = this.geometry.getAttribute('aTint') as THREE.BufferAttribute;
    tc.setXYZ(i, tint.r, tint.g, tint.b);
    (this.geometry.getAttribute('aSeed') as THREE.BufferAttribute).setX(i, Math.random());
  }

  update(dt: number, wind: THREE.Vector3) {
    const p = this.pos, v = this.vel, d = this.data, e = this.extra;
    for (let i = 0; i < SMOKE_MAX; i++) {
      const life = d[i * 4 + 1];
      if (life <= 0) continue;
      const age = d[i * 4] + dt;
      if (age >= life) { d[i * 4 + 1] = 0; d[i * 4 + 2] = 0; continue; }
      d[i * 4] = age;
      const k = Math.exp(-e[i * 4 + 1] * dt);
      v[i * 3] = (v[i * 3] - wind.x) * k + wind.x;
      v[i * 3 + 1] = (v[i * 3 + 1]) * k + e[i * 4] * dt;
      v[i * 3 + 2] = (v[i * 3 + 2] - wind.z) * k + wind.z;
      p[i * 3] += v[i * 3] * dt;
      p[i * 3 + 1] += v[i * 3 + 1] * dt;
      p[i * 3 + 2] += v[i * 3 + 2] * dt;
    }
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aData') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aTint') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aSeed') as THREE.BufferAttribute).needsUpdate = true;
  }

  setLight(sunDirView: THREE.Vector3, sunColor: THREE.Color, sky: THREE.Color, pixelScale: number) {
    this.mat.uniforms.uSunDirView.value.copy(sunDirView);
    this.mat.uniforms.uSunColor.value.copy(sunColor);
    this.mat.uniforms.uSky.value.copy(sky);
    this.mat.uniforms.uPixelScale.value = pixelScale;
  }
}

// --------------------------------------------------------------- sparks -----

const SPARK_MAX = 4000;

class SparkPool extends THREE.Points {
  private pos: Float32Array;
  private vel: Float32Array;
  private data: Float32Array;   // age, life, size, drag
  private head = 0;
  private mat: THREE.ShaderMaterial;

  constructor() {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(SPARK_MAX * 3);
    const data = new Float32Array(SPARK_MAX * 4);
    const tint = new Float32Array(SPARK_MAX * 3);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aData', new THREE.BufferAttribute(data, 4));
    g.setAttribute('aTint', new THREE.BufferAttribute(tint, 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uPixelScale: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute vec4 aData; attribute vec3 aTint;
        uniform float uPixelScale;
        varying float vA; varying vec3 vC;
        void main() {
          float t = clamp(aData.x / aData.y, 0.0, 1.0);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // Sparks cool as they fly: white hot, then orange, then out.
          vC = mix(aTint * 2.6, aTint * 0.20, t * t);
          vA = (1.0 - t) * (1.0 - t);
          gl_PointSize = clamp(aData.z * uPixelScale / max(-mv.z, 1.0), 1.0, 60.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying float vA; varying vec3 vC;
        void main() {
          vec2 q = gl_PointCoord * 2.0 - 1.0;
          float r2 = dot(q, q);
          if (r2 > 1.0) discard;
          float a = vA * (1.0 - r2) * (1.0 - r2);
          gl_FragColor = vec4(vC * a, a);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    super(g, mat);
    this.pos = pos; this.data = data; this.mat = mat;
    this.vel = new Float32Array(SPARK_MAX * 3);
    this.frustumCulled = false;
    this.renderOrder = 19;
  }

  spawn(p: THREE.Vector3, v: THREE.Vector3, life: number, size: number, tint: THREE.Color, drag = 0.9) {
    const i = this.head; this.head = (this.head + 1) % SPARK_MAX;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    this.data[i * 4] = 0; this.data[i * 4 + 1] = life;
    this.data[i * 4 + 2] = size; this.data[i * 4 + 3] = drag;
    (this.geometry.getAttribute('aTint') as THREE.BufferAttribute).setXYZ(i, tint.r, tint.g, tint.b);
  }

  update(dt: number) {
    const p = this.pos, v = this.vel, d = this.data;
    for (let i = 0; i < SPARK_MAX; i++) {
      const life = d[i * 4 + 1];
      if (life <= 0) continue;
      const age = d[i * 4] + dt;
      if (age >= life) { d[i * 4 + 1] = 0; continue; }
      d[i * 4] = age;
      const k = Math.exp(-d[i * 4 + 3] * dt);
      v[i * 3] *= k; v[i * 3 + 2] *= k;
      v[i * 3 + 1] = v[i * 3 + 1] * k - 9.81 * dt;
      p[i * 3] += v[i * 3] * dt; p[i * 3 + 1] += v[i * 3 + 1] * dt; p[i * 3 + 2] += v[i * 3 + 2] * dt;
    }
    for (const n of ['position', 'aData', 'aTint']) (this.geometry.getAttribute(n) as THREE.BufferAttribute).needsUpdate = true;
  }

  setPixelScale(s: number) { this.mat.uniforms.uPixelScale.value = s; }
}

// -------------------------------------------------------------- tracers -----

const TRACER_MAX = 600;

/**
 * A round in flight, drawn as a quad stretched along its own velocity. Points cannot
 * do this: a tracer is a streak, and its length is what tells the eye how fast the
 * round is going. The quad is built in view space so it always faces the camera while
 * staying aligned with the trajectory.
 */
class TracerPool extends THREE.Mesh {
  private aPos: THREE.InstancedBufferAttribute;
  private aVel: THREE.InstancedBufferAttribute;
  private aData: THREE.InstancedBufferAttribute;  // age, life, length, width
  private head = 0;
  private live = 0;
  private mat: THREE.ShaderMaterial;

  constructor() {
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.attributes.position = base.attributes.position;
    g.attributes.uv = base.attributes.uv;
    const aPos = new THREE.InstancedBufferAttribute(new Float32Array(TRACER_MAX * 3), 3);
    const aVel = new THREE.InstancedBufferAttribute(new Float32Array(TRACER_MAX * 3), 3);
    const aData = new THREE.InstancedBufferAttribute(new Float32Array(TRACER_MAX * 4), 4);
    g.setAttribute('aPos', aPos); g.setAttribute('aVel', aVel); g.setAttribute('aData', aData);
    g.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uPixelScale: { value: 600 } },
      vertexShader: /* glsl */ `
        attribute vec3 aPos; attribute vec3 aVel; attribute vec4 aData;
        uniform float uPixelScale;
        varying vec2 vUv; varying float vFade;
        void main() {
          float t = clamp(aData.x / aData.y, 0.0, 1.0);
          vUv = uv; vFade = 1.0 - t * t;
          vec3 c = (modelViewMatrix * vec4(aPos, 1.0)).xyz;
          vec3 av = (modelViewMatrix * vec4(aVel, 0.0)).xyz;
          // Along the track in view space; across it, whatever is perpendicular in the
          // image plane. Head on, the streak collapses to a dot, which is correct.
          vec3 dir = length(av) > 1e-4 ? normalize(av) : vec3(0.0, 0.0, 1.0);
          vec3 side = normalize(cross(dir, vec3(0.0, 0.0, 1.0)) + vec3(1e-5));
          // A round is a centimetre across and lands a kilometre away, so a streak of
          // its true width is a quarter of a pixel and simply never appears. Real
          // tracers are visible because they are small and violently bright, which a
          // renderer can only reproduce by giving them a floor in screen space.
          float depth = max(-c.z, 1.0);
          float minW = 2.6 * depth / uPixelScale;
          float w = max(aData.w, minW);
          float len = max(aData.z, minW * 9.0);
          vec3 p = c + dir * (uv.y - 0.5) * len + side * (uv.x - 0.5) * w;
          gl_Position = projectionMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec2 vUv; varying float vFade;
        void main() {
          // Bright core with a hot head and a cooling tail, soft across the streak.
          float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
          float along = smoothstep(0.0, 0.35, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
          float a = across * across * along * vFade;
          vec3 col = mix(vec3(2.0, 0.55, 0.10), vec3(3.6, 2.8, 1.7), smoothstep(0.45, 0.95, vUv.y));
          gl_FragColor = vec4(col * a, a);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    super(g, mat);
    this.aPos = aPos; this.aVel = aVel; this.aData = aData;
    this.mat = mat;
    this.frustumCulled = false;
    this.renderOrder = 19;
  }

  setPixelScale(s: number) { this.mat.uniforms.uPixelScale.value = s; }

  spawn(p: THREE.Vector3, v: THREE.Vector3, life: number, length: number, width: number) {
    const i = this.head; this.head = (this.head + 1) % TRACER_MAX;
    this.aPos.setXYZ(i, p.x, p.y, p.z);
    this.aVel.setXYZ(i, v.x, v.y, v.z);
    this.aData.setXYZW(i, 0, life, length, width);
    this.live = Math.min(TRACER_MAX, this.live + 1);
    (this.geometry as THREE.InstancedBufferGeometry).instanceCount = TRACER_MAX;
  }

  update(dt: number) {
    const d = this.aData.array as Float32Array;
    const p = this.aPos.array as Float32Array;
    const v = this.aVel.array as Float32Array;
    for (let i = 0; i < TRACER_MAX; i++) {
      if (d[i * 4 + 1] <= 0) continue;
      const age = d[i * 4] + dt;
      if (age >= d[i * 4 + 1]) { d[i * 4 + 1] = 0; d[i * 4 + 2] = 0; continue; }
      d[i * 4] = age;
      p[i * 3] += v[i * 3] * dt; p[i * 3 + 1] += v[i * 3 + 1] * dt; p[i * 3 + 2] += v[i * 3 + 2] * dt;
      v[i * 3 + 1] -= 9.81 * dt;
    }
    this.aPos.needsUpdate = true; this.aVel.needsUpdate = true; this.aData.needsUpdate = true;
  }
}

// --------------------------------------------------------------- blasts -----

const BLAST_MAX = 96;
export const BLAST_FLASH = 0;     // muzzle / launch: a short hard flash
export const BLAST_FIRE = 1;      // expanding fireball
export const BLAST_RING = 2;      // shock ring
export const BLAST_HEAT = 3;      // the same ring, but written into the heat buffer

const BLAST_VERT = /* glsl */ `
attribute vec3 aPos; attribute vec4 aData;   // age, life, r0, growth
attribute vec4 aTint;                        // rgb + kind
varying vec2 vUv; varying float vT; varying vec3 vTint; varying float vKind;
void main() {
  float t = clamp(aData.x / aData.y, 0.0, 1.0);
  vUv = uv; vT = t; vTint = aTint.rgb; vKind = aTint.w;
  vec3 c = (modelViewMatrix * vec4(aPos, 1.0)).xyz;
  // Growth is deliberately not linear: a blast wave decelerates hard, and a fireball
  // that expands at a constant rate reads as a balloon.
  float r = aData.z + aData.w * pow(t, 0.42);
  vec3 p = c + vec3((uv - 0.5) * 2.0 * r, 0.0);
  gl_Position = projectionMatrix * vec4(p, 1.0);
}`;

const BLAST_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv; varying float vT; varying vec3 vTint; varying float vKind;
float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
void main() {
  vec2 q = vUv * 2.0 - 1.0;
  float r = length(q);
  if (r > 1.0) discard;
  float a; vec3 col;
  if (vKind < 0.5) {
    // Flash: a hard star that dies almost at once.
    float core = pow(max(0.0, 1.0 - r), 2.2);
    float spikes = pow(max(0.0, 1.0 - min(abs(q.x), abs(q.y)) * 6.0), 3.0) * 0.55;
    a = (core + spikes * (1.0 - r)) * (1.0 - vT) * (1.0 - vT);
    col = vTint * 2.0;
  } else if (vKind < 1.5) {
    // Fireball: boiling noise, white at the heart, going to soot at the edge and
    // with age. Additive early, which is what makes the first frames read as light.
    float ang = atan(q.y, q.x);
    float n = vnoise(vec2(ang * 2.4, r * 3.2) + vT * 1.7) * 0.6
            + vnoise(vec2(ang * 5.1, r * 7.4) - vT * 2.6) * 0.4;
    float edge = 1.0 - smoothstep(0.35, 1.0, r + (n - 0.5) * 0.75);
    float heat = clamp(1.25 - r * 1.1 - vT * 1.25 + n * 0.35, 0.0, 1.0);
    col = mix(vTint * 0.28, vec3(2.6, 2.0, 1.25), heat * heat);
    col = mix(col, vec3(0.05, 0.04, 0.04), smoothstep(0.55, 1.0, vT) * 0.85);
    a = edge * (1.0 - smoothstep(0.55, 1.0, vT));
  } else {
    // Shock ring: a thin bright annulus racing outward.
    float w = mix(0.16, 0.045, vT);
    float ring = 1.0 - smoothstep(0.0, w, abs(r - (0.55 + 0.45 * vT)));
    a = ring * (1.0 - vT) * (1.0 - vT) * 0.9;
    col = vTint * 2.0;
  }
  if (a < 0.004) discard;
  gl_FragColor = vec4(col * a, a);
}`;

const HEAT_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv; varying float vT; varying vec3 vTint; varying float vKind;
float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
void main() {
  vec2 q = vUv * 2.0 - 1.0;
  float r = length(q);
  if (r > 1.0) discard;
  float shell = 1.0 - smoothstep(0.0, 0.30, abs(r - (0.45 + 0.55 * vT)));
  float s = shell * (1.0 - vT) * (1.0 - vT);
  vec2 dir = r > 1e-4 ? q / r : vec2(0.0);
  float n = vnoise(q * 6.0 + vT * 3.0) - 0.5;
  gl_FragColor = vec4(dir.x * s * (0.6 + n), dir.y * s * (0.6 + n), s, 1.0);
}`;

class BlastPool extends THREE.Mesh {
  aPos: THREE.InstancedBufferAttribute;
  aData: THREE.InstancedBufferAttribute;
  aTint: THREE.InstancedBufferAttribute;
  private head = 0;

  constructor(frag: string, blending: THREE.Blending, layer: number | null) {
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.attributes.position = base.attributes.position;
    g.attributes.uv = base.attributes.uv;
    const aPos = new THREE.InstancedBufferAttribute(new Float32Array(BLAST_MAX * 3), 3);
    const aData = new THREE.InstancedBufferAttribute(new Float32Array(BLAST_MAX * 4), 4);
    const aTint = new THREE.InstancedBufferAttribute(new Float32Array(BLAST_MAX * 4), 4);
    g.setAttribute('aPos', aPos); g.setAttribute('aData', aData); g.setAttribute('aTint', aTint);
    g.instanceCount = BLAST_MAX;
    super(g, new THREE.ShaderMaterial({
      vertexShader: BLAST_VERT, fragmentShader: frag,
      transparent: true, depthWrite: false, blending, side: THREE.DoubleSide,
    }));
    this.aPos = aPos; this.aData = aData; this.aTint = aTint;
    this.frustumCulled = false;
    this.renderOrder = 20;
    if (layer !== null) this.layers.set(layer);
  }

  spawn(p: THREE.Vector3, life: number, r0: number, growth: number, tint: THREE.Color, kind: number) {
    const i = this.head; this.head = (this.head + 1) % BLAST_MAX;
    this.aPos.setXYZ(i, p.x, p.y, p.z);
    this.aData.setXYZW(i, 0, life, r0, growth);
    this.aTint.setXYZW(i, tint.r, tint.g, tint.b, kind);
    this.aPos.needsUpdate = this.aData.needsUpdate = this.aTint.needsUpdate = true;
  }

  update(dt: number) {
    const d = this.aData.array as Float32Array;
    for (let i = 0; i < BLAST_MAX; i++) {
      if (d[i * 4 + 1] <= 0) continue;
      const age = d[i * 4] + dt;
      if (age >= d[i * 4 + 1]) { d[i * 4 + 1] = 0; d[i * 4 + 2] = d[i * 4 + 3] = 0; continue; }
      d[i * 4] = age;
    }
    this.aData.needsUpdate = true;
  }
}

// --------------------------------------------------------------- debris -----

const DEBRIS_MAX = 400;

class DebrisPool extends THREE.InstancedMesh {
  private pos: Float32Array;
  private vel: Float32Array;
  private spin: Float32Array;
  private rot: Float32Array;
  private life: Float32Array;
  private sizes: Float32Array;
  private head = 0;
  private m = new THREE.Matrix4();
  private e = new THREE.Euler();
  private qq = new THREE.Quaternion();
  private sv = new THREE.Vector3();

  constructor() {
    const g = new THREE.BoxGeometry(1, 0.55, 0.3);
    const mat = new THREE.MeshStandardMaterial({ color: 0x1c1a18, roughness: 0.85, metalness: 0.4 });
    super(g, mat, DEBRIS_MAX);
    this.pos = new Float32Array(DEBRIS_MAX * 3);
    this.vel = new Float32Array(DEBRIS_MAX * 3);
    this.spin = new Float32Array(DEBRIS_MAX * 3);
    this.rot = new Float32Array(DEBRIS_MAX * 3);
    this.life = new Float32Array(DEBRIS_MAX * 2);   // age, life
    this.sizes = new Float32Array(DEBRIS_MAX);
    this.frustumCulled = false;
    this.castShadow = true;
    for (let i = 0; i < DEBRIS_MAX; i++) this.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
  }

  spawn(p: THREE.Vector3, v: THREE.Vector3, size: number, life: number) {
    const i = this.head; this.head = (this.head + 1) % DEBRIS_MAX;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    for (let k = 0; k < 3; k++) {
      this.spin[i * 3 + k] = (Math.random() - 0.5) * 18;
      this.rot[i * 3 + k] = Math.random() * 6.28;
    }
    this.life[i * 2] = 0; this.life[i * 2 + 1] = life;
    this.sizes[i] = size;
  }

  update(dt: number, ground: (x: number, z: number) => number) {
    let any = false;
    for (let i = 0; i < DEBRIS_MAX; i++) {
      const life = this.life[i * 2 + 1];
      if (life <= 0) continue;
      const age = this.life[i * 2] + dt;
      if (age >= life) {
        this.life[i * 2 + 1] = 0;
        this.setMatrixAt(i, this.m.makeScale(0, 0, 0));
        any = true; continue;
      }
      this.life[i * 2] = age;
      const v = this.vel, p = this.pos;
      v[i * 3 + 1] -= 9.81 * dt;
      const k = Math.exp(-0.5 * dt);
      v[i * 3] *= k; v[i * 3 + 2] *= k;
      p[i * 3] += v[i * 3] * dt; p[i * 3 + 1] += v[i * 3 + 1] * dt; p[i * 3 + 2] += v[i * 3 + 2] * dt;
      const g = ground(p[i * 3], p[i * 3 + 2]);
      if (p[i * 3 + 1] < g + 0.15) {
        // Bounce, losing most of the energy: debris skitters, it does not trampoline.
        p[i * 3 + 1] = g + 0.15;
        v[i * 3 + 1] = Math.abs(v[i * 3 + 1]) * 0.28;
        v[i * 3] *= 0.55; v[i * 3 + 2] *= 0.55;
        for (let c = 0; c < 3; c++) this.spin[i * 3 + c] *= 0.5;
      }
      for (let c = 0; c < 3; c++) this.rot[i * 3 + c] += this.spin[i * 3 + c] * dt;
      const fade = 1 - Math.max(0, (age - life * 0.8) / (life * 0.2));
      const s = this.sizes[i] * fade;
      this.e.set(this.rot[i * 3], this.rot[i * 3 + 1], this.rot[i * 3 + 2]);
      this.qq.setFromEuler(this.e);
      this.m.compose(_v.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]), this.qq, this.sv.set(s, s, s));
      this.setMatrixAt(i, this.m);
      any = true;
    }
    if (any) this.instanceMatrix.needsUpdate = true;
  }
}

// --------------------------------------------------------------- lights -----

/**
 * A handful of point lights, handed out to whatever needs to throw light and taken
 * back when it stops. WebGL has a hard budget for these, so they are rationed by
 * priority: a fireball outranks a muzzle flash outranks a rocket motor.
 */
class LightPool {
  readonly lights: THREE.PointLight[] = [];
  private prio: number[] = [];
  private ttl: number[] = [];

  constructor(n = 7) {
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 140, 2);
      l.visible = false;
      this.lights.push(l); this.prio.push(-1); this.ttl.push(0);
    }
  }

  /** Ask for a light. Returns null if everything brighter is already in use. */
  request(priority: number): number {
    let free = -1, weakest = -1, weakestP = priority;
    for (let i = 0; i < this.lights.length; i++) {
      if (this.ttl[i] <= 0) { free = i; break; }
      if (this.prio[i] < weakestP) { weakestP = this.prio[i]; weakest = i; }
    }
    const i = free >= 0 ? free : weakest;
    if (i < 0) return -1;
    this.prio[i] = priority;
    return i;
  }

  set(i: number, p: THREE.Vector3, color: THREE.Color, intensity: number, distance: number, ttl: number) {
    if (i < 0) return;
    const l = this.lights[i];
    l.position.copy(p); l.color.copy(color); l.intensity = intensity; l.distance = distance;
    l.visible = intensity > 0.001;
    this.ttl[i] = ttl;
  }

  update(dt: number) {
    for (let i = 0; i < this.lights.length; i++) {
      if (this.ttl[i] <= 0) continue;
      this.ttl[i] -= dt;
      if (this.ttl[i] <= 0) { this.lights[i].visible = false; this.lights[i].intensity = 0; this.prio[i] = -1; }
    }
  }
}

// ============================================================== facade ======

const C = (r: number, g: number, b: number) => new THREE.Color(r, g, b);
const SMOKE_WHITE = C(0.86, 0.87, 0.88);
const SMOKE_GREY = C(0.34, 0.34, 0.35);
const SMOKE_BLACK = C(0.055, 0.052, 0.050);
const DIRT = C(0.36, 0.30, 0.22);
const SPARK_HOT = C(1.0, 0.62, 0.22);

export class CombatFx extends THREE.Group {
  readonly smoke = new SmokePool();
  readonly sparks = new SparkPool();
  readonly tracers = new TracerPool();
  readonly blasts = new BlastPool(BLAST_FRAG, THREE.AdditiveBlending, null);
  readonly heat = new BlastPool(HEAT_FRAG, THREE.NormalBlending, HEAT_LAYER);
  readonly debris = new DebrisPool();
  readonly lights = new LightPool();
  /** Set by the world each frame; smoke drifts on it. */
  readonly wind = new THREE.Vector3();
  private sunView = new THREE.Vector3(0, 1, 0);

  constructor() {
    super();
    this.add(this.smoke, this.sparks, this.tracers, this.blasts, this.heat, this.debris);
    for (const l of this.lights.lights) this.add(l);
    this.frustumCulled = false;
  }

  // ---- primitives the weapons call ------------------------------------------

  tracer(p: THREE.Vector3, v: THREE.Vector3, life: number, length = 11, width = 0.30) {
    this.tracers.spawn(p, v, life, length, width);
  }

  /**
   * The gun going off. A hard flash, a stab of light on the airframe, a cough of
   * grey smoke that the slipstream immediately takes away.
   */
  muzzleFlash(p: THREE.Vector3, dir: THREE.Vector3, drift: THREE.Vector3, night: number) {
    // A thirty-millimetre muzzle flash is about a metre of flame and gone in a frame.
    // Sized for drama it swallows the whole aircraft, and the bloom finishes the job.
    this.blasts.spawn(p, 0.045, 0.20, 0.55, C(1.0, 0.80, 0.46), BLAST_FLASH);
    const li = this.lights.request(2);
    this.lights.set(li, p, C(1.0, 0.72, 0.34), 210 * (0.35 + 0.65 * night), 45, 0.05);
    if (Math.random() < 0.5) {
      _v.copy(drift).addScaledVector(dir, 12).add(_v2.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 6));
      this.smoke.spawn(p, _v, 0.32 + Math.random() * 0.22, 0.10, 0.85, SMOKE_GREY, 0.4, 3.2);
    }
  }

  /** A round striking something solid: sparks along the surface, and a puff of it. */
  impact(p: THREE.Vector3, n: THREE.Vector3, power: number, kind: 'metal' | 'dirt' | 'water') {
    const nSpark = kind === 'metal' ? 16 : 6;
    for (let i = 0; i < nSpark; i++) {
      _v.copy(n).multiplyScalar(4 + Math.random() * 12)
        .add(_v2.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(14));
      this.sparks.spawn(p, _v, 0.35 + Math.random() * 0.5, 0.20 * power, SPARK_HOT, 1.2);
    }
    if (kind === 'dirt') {
      for (let i = 0; i < 4; i++) {
        _v.copy(n).multiplyScalar(3 + Math.random() * 7)
          .add(_v2.set(Math.random() - 0.5, 0, Math.random() - 0.5).multiplyScalar(5));
        this.smoke.spawn(p, _v, 0.9 + Math.random() * 0.8, 0.35 * power, 2.4 * power, DIRT, 0.9, 1.9);
      }
    } else if (kind === 'water') {
      for (let i = 0; i < 6; i++) {
        _v.copy(n).multiplyScalar(6 + Math.random() * 12)
          .add(_v2.set(Math.random() - 0.5, 0, Math.random() - 0.5).multiplyScalar(6));
        this.smoke.spawn(p, _v, 0.7 + Math.random() * 0.5, 0.30 * power, 1.8 * power, SMOKE_WHITE, 0.2, 2.4);
      }
    } else {
      this.smoke.spawn(p, _v.copy(n).multiplyScalar(4), 0.5, 0.25 * power, 1.6 * power, SMOKE_GREY, 0.6, 2.4);
    }
    this.blasts.spawn(p, 0.10, 0.25 * power, 0.9 * power, C(1.0, 0.66, 0.30), BLAST_FLASH);
  }

  /** A spent case tumbling out of the ejection port. */
  casing(p: THREE.Vector3, v: THREE.Vector3) {
    this.debris.spawn(p, v, 0.10, 3.5);
  }

  /**
   * The motor lighting. This is the moment the launch reads as a launch, so it gets
   * its own flash, its own light, and a burst of smoke that is left behind at the
   * point of ignition rather than carried with the missile.
   */
  motorIgnite(p: THREE.Vector3, back: THREE.Vector3, night: number, scale = 1) {
    // `scale` exists for salvos: twenty rockets each throwing a full launch flash in
    // half a second is a white screen, not a launch. The smoke is left at full strength
    // because that is the part that should swamp the aircraft.
    this.blasts.spawn(p, 0.18, 0.34 * scale, 1.3 * scale, C(1.0, 0.62, 0.24), BLAST_FLASH);
    this.heat.spawn(p, 0.55, 1.0 * scale, 6.0 * scale, C(1, 1, 1), BLAST_HEAT);
    const li = this.lights.request(3);
    this.lights.set(li, p, C(1.0, 0.60, 0.26), 900 * scale * (0.4 + 0.6 * night), 110, 0.26);
    for (let i = 0; i < 14; i++) {
      _v.copy(back).multiplyScalar(14 + Math.random() * 34)
        .add(_v2.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(14));
      this.smoke.spawn(p, _v, 2.4 + Math.random() * 2.6, 0.6, 8.5, SMOKE_WHITE, 0.9, 1.0);
      if (i < 6) this.sparks.spawn(p, _v.clone().multiplyScalar(1.5), 0.5, 0.4, SPARK_HOT, 1.0);
    }
  }

  /** One puff of a rocket motor's exhaust trail. */
  motorTrail(p: THREE.Vector3, v: THREE.Vector3, scale: number) {
    // Born close to the rocket's own diameter and spreading to a few metres. A trail
    // that starts wide is a cloud; a trail that grows is smoke.
    this.smoke.spawn(p, v, 3.2 + Math.random() * 2.6, 0.55 * scale, 3.6 * scale, SMOKE_WHITE, 0.30, 1.05);
  }

  /** A damaged aircraft trailing smoke. */
  damageTrail(p: THREE.Vector3, v: THREE.Vector3, severity: number) {
    this.smoke.spawn(p, v, 2.0 + Math.random() * 2.0, 0.5, 5.0 + 6.0 * severity,
      severity > 0.6 ? SMOKE_BLACK : SMOKE_GREY, 1.2, 0.8);
  }

  /**
   * Everything blowing up, in layers: light first, then fire, then the ring, then what
   * is thrown, then the column that stays. The order matters because the eye reads
   * them in that order, one frame apart.
   */
  explosion(p: THREE.Vector3, power: number, kind: 'air' | 'ground' | 'fuel', night = 0) {
    const s = power;
    this.blasts.spawn(p, 0.09, 0.4 * s, 2.2 * s, C(1.0, 0.92, 0.72), BLAST_FLASH);
    this.blasts.spawn(p, kind === 'fuel' ? 1.9 : 1.05, 0.7 * s, 3.4 * s, C(0.9, 0.42, 0.14), BLAST_FIRE);
    this.blasts.spawn(p, 0.55, 1.0 * s, 7.5 * s, C(1.0, 0.85, 0.62), BLAST_RING);
    this.heat.spawn(p, 0.75, 1.5 * s, 12.0 * s, C(1, 1, 1), BLAST_HEAT);

    const li = this.lights.request(kind === 'fuel' ? 6 : 5);
    this.lights.set(li, p, C(1.0, 0.55, 0.20), 9000 * s * (0.4 + 0.6 * night), 60 + 40 * s, 0.45);

    const nSpark = Math.min(90, Math.round(24 * s));
    for (let i = 0; i < nSpark; i++) {
      _v.set(Math.random() - 0.5, Math.random() * 0.7, Math.random() - 0.5).normalize()
        .multiplyScalar((10 + Math.random() * 36) * Math.sqrt(s));
      this.sparks.spawn(p, _v, 0.7 + Math.random() * 1.4, 0.35 * s, SPARK_HOT, 0.7);
    }
    const nDeb = Math.min(28, Math.round(7 * s));
    for (let i = 0; i < nDeb; i++) {
      _v.set(Math.random() - 0.5, Math.random() * 0.9 + 0.1, Math.random() - 0.5).normalize()
        .multiplyScalar((7 + Math.random() * 22) * Math.sqrt(s));
      this.debris.spawn(p, _v, 0.25 + Math.random() * 0.55 * s, 3 + Math.random() * 3);
    }
    // Smoke: a ball for an air burst, a column with a dirt skirt for a ground one.
    const nSmoke = Math.min(46, Math.round(12 * s));
    for (let i = 0; i < nSmoke; i++) {
      _v.set(Math.random() - 0.5, Math.random() * (kind === 'air' ? 0.6 : 1.3), Math.random() - 0.5)
        .multiplyScalar((5 + Math.random() * 13) * Math.sqrt(s));
      this.smoke.spawn(p, _v, 3.5 + Math.random() * 4.5, 0.8 * s, 9.0 * s, SMOKE_BLACK, 2.6 + 2.0 * s, 0.62);
    }
    if (kind !== 'air') {
      // The ring of dust a ground burst pushes out along the surface, which is what
      // gives the eye the scale of the thing.
      for (let i = 0; i < Math.min(40, Math.round(14 * s)); i++) {
        const a = Math.random() * Math.PI * 2;
        _v.set(Math.cos(a), 0.10 + Math.random() * 0.25, Math.sin(a)).multiplyScalar((11 + Math.random() * 20) * Math.sqrt(s));
        _v2.copy(p); _v2.y += 0.5;
        this.smoke.spawn(_v2, _v, 3.0 + Math.random() * 3.0, 0.7 * s, 11.0 * s, DIRT, 0.5, 0.9);
      }
    }
  }

  /** A wreck that keeps burning. Called every frame while the fire lives. */
  fire(p: THREE.Vector3, radius: number, intensity: number, dt: number, night: number) {
    if (Math.random() < dt * 22 * intensity) {
      _v.set((Math.random() - 0.5) * radius, Math.random() * radius * 0.4, (Math.random() - 0.5) * radius);
      _v2.copy(p).add(_v);
      this.smoke.spawn(_v2, _v.set((Math.random() - 0.5) * 2, 3.5 + Math.random() * 4, (Math.random() - 0.5) * 2),
        6.0 + Math.random() * 6.0, 0.9 * radius * 0.4, 7.0 * radius * 0.5, SMOKE_BLACK, 4.5, 0.35);
    }
    if (Math.random() < dt * 30 * intensity) {
      _v2.copy(p).add(_v.set((Math.random() - 0.5) * radius * 0.8, Math.random() * 0.6, (Math.random() - 0.5) * radius * 0.8));
      this.blasts.spawn(_v2, 0.55 + Math.random() * 0.4, 0.35 * radius, 1.0 * radius,
        C(0.95, 0.42, 0.12), BLAST_FIRE);
    }
    if (Math.random() < dt * 6) {
      _v2.copy(p); _v2.y += radius * 0.3;
      const li = this.lights.request(1);
      // The flicker is what sells a fire at night; a steady lamp reads as a street light.
      this.lights.set(li, _v2, C(1.0, 0.48, 0.16),
        (900 + Math.random() * 700) * radius * (0.25 + 0.75 * night), 40 + 20 * radius, 0.22);
    }
  }

  /** Countermeasures: a burning magnesium flare, tumbling and falling away. */
  flare(p: THREE.Vector3, v: THREE.Vector3, night: number) {
    this.blasts.spawn(p, 0.10, 0.4, 0.8, C(1.0, 0.95, 0.80), BLAST_FLASH);
    const li = this.lights.request(2);
    this.lights.set(li, p, C(1.0, 0.85, 0.55), 1400 * (0.3 + 0.7 * night), 90, 0.12);
    for (let i = 0; i < 5; i++) {
      _v.copy(v).add(_v2.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(5));
      this.sparks.spawn(p, _v, 0.5 + Math.random() * 0.5, 0.55, C(1.0, 0.92, 0.70), 0.6);
    }
    this.smoke.spawn(p, v, 1.4, 0.25, 2.6, SMOKE_WHITE, 0.7, 1.4);
  }

  // ---- frame ------------------------------------------------------------------

  update(dt: number, camera: THREE.PerspectiveCamera, sunDir: THREE.Vector3,
         sunColor: THREE.Color, skyColor: THREE.Color, pixelScale: number,
         ground: (x: number, z: number) => number) {
    this.sunView.copy(sunDir).transformDirection(camera.matrixWorldInverse);
    this.smoke.setLight(this.sunView, sunColor, skyColor, pixelScale);
    this.sparks.setPixelScale(pixelScale);
    this.tracers.setPixelScale(pixelScale);
    this.smoke.update(dt, this.wind);
    this.sparks.update(dt);
    this.tracers.update(dt);
    this.blasts.update(dt);
    this.heat.update(dt);
    this.debris.update(dt, ground);
    this.lights.update(dt);
  }
}
