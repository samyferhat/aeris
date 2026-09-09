import * as THREE from 'three';
import { FlightState } from '../aircraft/FlightModel';

/** Objects on this layer are rendered only into the heat-distortion buffer. */
export const HEAT_LAYER = 2;

/**
 * Afterburner plume.
 *
 * Three parts, because a reheat plume is three things at once:
 *   * the visible flame — a blue-white core of burning fuel at the throat, the regular
 *     bright nodes of the shock diamonds where the over-expanded jet re-compresses, and
 *     an orange sheath of cooler combustion spreading downstream;
 *   * the light it throws — enough at night to pick out the tail booms and the runway;
 *   * the air it heats — refracting whatever is behind it, which is the cue that says
 *     "this is hot" more than the colour does.
 *
 * The flame is drawn additively into the scene. The distortion is drawn as a plain
 * cone on a dedicated layer into a small buffer that the composite pass reads as a
 * screen-space offset, which is much cheaper than a real refraction pass and, for a
 * shimmer, indistinguishable.
 */
const FLAME_VERT = /* glsl */ `
varying vec3 vLocal;
varying vec2 vUvF;
void main() {
  vLocal = position;
  vUvF = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FLAME_FRAG = /* glsl */ `
precision highp float;
uniform float uAmount;     // 0 = dry, 1 = full reheat
uniform float uTime;
uniform float uLength;
uniform float uRadius;
varying vec3 vLocal;
varying vec2 vUvF;

float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}

void main() {
  // The plume runs along -Z from the nozzle exit.
  float t = clamp(-vLocal.z / uLength, 0.0, 1.0);
  float r = length(vLocal.xy) / uRadius;

  // The jet necks down just aft of the throat, then spreads.
  float width = mix(0.62, 1.35, smoothstep(0.0, 1.0, t)) * (0.55 + 0.45 * uAmount);
  float radial = 1.0 - smoothstep(width * 0.45, width, r);
  if (radial <= 0.001) discard;

  // Turbulence grows downstream; near the throat the flow is still smooth.
  float turb = noise(vec3(vLocal.xy * 3.2, -vLocal.z * 1.1 - uTime * 26.0));
  float turb2 = noise(vec3(vLocal.xy * 8.0, -vLocal.z * 2.6 - uTime * 44.0));
  float shred = mix(1.0, 0.45 + 1.1 * (turb * 0.65 + turb2 * 0.35), smoothstep(0.12, 0.9, t));

  // Shock diamonds: bright nodes at a regular spacing that stretches with thrust.
  float spacing = mix(0.085, 0.135, uAmount);
  float diamond = pow(max(0.0, sin(t / spacing * 3.14159)), 14.0);
  diamond *= (1.0 - smoothstep(0.05, 0.72, t)) * smoothstep(0.6, 0.15, r);

  // Colour: white-blue core, violet-blue mid, orange sheath.
  // Values above 1 are deliberate — this is an HDR buffer and the bloom pass turns the
  // excess into glow — but the first cut ran three times hotter and simply clipped to
  // white, losing the blue core that makes reheat recognisable.
  vec3 core = vec3(1.35, 1.50, 1.85);
  vec3 mid  = vec3(0.40, 0.46, 1.00);
  vec3 outer= vec3(0.90, 0.32, 0.08);
  float coreMask = (1.0 - smoothstep(0.0, 0.30, t)) * (1.0 - smoothstep(0.10, 0.55, r));
  float midMask  = (1.0 - smoothstep(0.10, 0.75, t)) * (1.0 - smoothstep(0.35, 0.95, r));
  vec3 col = outer;
  col = mix(col, mid, clamp(midMask, 0.0, 1.0));
  col = mix(col, core, clamp(coreMask, 0.0, 1.0));
  col += core * diamond * 0.95;

  // Fades out downstream and with how far the throttle is past the detent.
  float axial = (1.0 - smoothstep(0.55, 1.0, t));
  float a = radial * axial * shred * uAmount;
  // Even dry, a hot nozzle glows a little.
  a = max(a, radial * (1.0 - smoothstep(0.0, 0.16, t)) * 0.22);
  gl_FragColor = vec4(col * a, a);
}`;

const HEAT_FRAG = /* glsl */ `
precision highp float;
uniform float uAmount;
uniform float uTime;
uniform float uLength;
uniform float uRadius;
varying vec3 vLocal;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
void main() {
  float t = clamp(-vLocal.z / uLength, 0.0, 1.0);
  float r = length(vLocal.xy) / uRadius;
  // The shimmer is widest and strongest well downstream, where the plume has mixed.
  float width = mix(0.5, 2.4, t);
  float radial = 1.0 - smoothstep(width * 0.4, width, r);
  float n1 = noise(vec3(vLocal.xy * 2.1, -vLocal.z * 0.8 - uTime * 14.0)) - 0.5;
  float n2 = noise(vec3(vLocal.xy * 5.3 + 7.0, -vLocal.z * 1.7 - uTime * 22.0)) - 0.5;
  float strength = radial * smoothstep(0.02, 0.35, t) * (1.0 - smoothstep(0.7, 1.0, t)) * (0.35 + 0.65 * uAmount);
  // rg carries the screen-space offset, b its magnitude for the composite to weight by.
  gl_FragColor = vec4(n1 * strength, n2 * strength, strength, 1.0);
}`;

export class Afterburner extends THREE.Group {
  private flames: THREE.Mesh[] = [];
  private heats: THREE.Mesh[] = [];
  private lights: THREE.PointLight[] = [];
  private flameMat: THREE.ShaderMaterial;
  private heatMat: THREE.ShaderMaterial;
  private time = 0;
  /** Peak plume length in metres at full reheat. */
  private length = 9.0;
  private radius = 0.62;

  constructor(exits: THREE.Vector3[], radius = 0.62, length = 9.0) {
    super();
    this.radius = radius;
    this.length = length;
    const uniforms = {
      uAmount: { value: 0 }, uTime: { value: 0 },
      uLength: { value: length }, uRadius: { value: radius },
    };
    this.flameMat = new THREE.ShaderMaterial({
      vertexShader: FLAME_VERT, fragmentShader: FLAME_FRAG, uniforms,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.heatMat = new THREE.ShaderMaterial({
      vertexShader: FLAME_VERT, fragmentShader: HEAT_FRAG, uniforms,
      transparent: false, depthWrite: false, blending: THREE.NormalBlending, side: THREE.DoubleSide,
    });

    // A cone opening downstream, long enough to hold the whole plume.
    const geo = new THREE.CylinderGeometry(radius * 0.75, radius * 2.6, length, 20, 12, true);
    geo.rotateX(Math.PI / 2);          // axis along -Z
    geo.translate(0, 0, -length / 2);

    for (const exit of exits) {
      const flame = new THREE.Mesh(geo, this.flameMat);
      flame.position.copy(exit);
      flame.frustumCulled = false;
      flame.renderOrder = 15;
      this.add(flame);
      this.flames.push(flame);

      const heat = new THREE.Mesh(geo, this.heatMat);
      heat.position.copy(exit);
      heat.frustumCulled = false;
      heat.layers.set(HEAT_LAYER);
      this.add(heat);
      this.heats.push(heat);

      // Throws light on the tail booms, and on the ground during the take-off roll.
      const light = new THREE.PointLight(0xff8a3a, 0, 60, 2);
      light.position.copy(exit).add(new THREE.Vector3(0, 0, -1.5));
      this.add(light);
      this.lights.push(light);
    }
  }

  update(dt: number, s: FlightState, night: number) {
    this.time += dt;
    // Visible plume: mostly the afterburner, with a hot glow at high dry power too.
    const amount = Math.min(1, s.afterburner * 0.92 + Math.max(0, s.throttle - 0.55) * 0.22);
    this.flameMat.uniforms.uAmount.value = amount;
    this.flameMat.uniforms.uTime.value = this.time;
    const visible = amount > 0.01;
    for (const f of this.flames) f.visible = visible;
    for (const h of this.heats) h.visible = amount > 0.05;
    // Flicker: reheat is not steady.
    const flicker = 0.85 + 0.15 * Math.sin(this.time * 47) * Math.sin(this.time * 31 + 1.3);
    for (const l of this.lights) {
      l.intensity = amount * amount * 460 * flicker * (0.40 + 0.60 * night);
      l.distance = 30 + 45 * amount;
    }
  }

  get plumeLength() { return this.length; }
}
