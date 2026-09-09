import * as THREE from 'three';
import { FlightState } from '../aircraft/FlightModel';

/** Objects on this layer are rendered only into the heat-distortion buffer. */
export const HEAT_LAYER = 2;

/**
 * Afterburner plume.
 *
 * Three things at once, because that is what reheat is:
 *   * the visible flame — a blue-white core of burning fuel at the throat, the regular
 *     bright nodes where the over-expanded jet re-compresses (shock diamonds), and an
 *     orange sheath of cooler combustion spreading downstream;
 *   * the light it throws — enough at night to pick out the tail booms and the runway;
 *   * the air it heats — refracting whatever is behind it, which sells "hot" far better
 *     than the colour does.
 *
 * The flame is drawn as a camera-facing ribbon rather than a cone shell. A shell only
 * ever gives the shader its own surface radius, never the distance from the axis, so
 * the radial falloff a plume needs cannot be evaluated on one. The ribbon carries the
 * axis along its length and the profile across its width, which is correct from every
 * angle except straight down the pipe — and that case is covered by a separate disc
 * that fades in exactly as the ribbon degenerates.
 */
const PLUME_COMMON = /* glsl */ `
uniform float uAmount;
uniform float uTime;
uniform float uLength;
uniform float uRadius;
varying float vT;
// The quad's own coordinates, so the radius is measured per fragment. Interpolating a
// length across a four-vertex quad never returns to zero at the centre — every corner
// is at 1.41, so the interpolant is 1.41 everywhere and the whole sprite is discarded.
varying vec2 vQuad;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
/** Radius of the plume at station t, in metres. */
float plumeWidth(float t) {
  // Reheat is a column, not a trumpet: the jet leaves the nozzle over-expanded and only
  // spreads slowly. Flaring it to two and a half nozzle radii read as a rocket exhaust.
  return uRadius * mix(1.00, 1.55, smoothstep(0.0, 1.0, t)) * (0.70 + 0.30 * uAmount);
}
`;

/**
 * The plume is a stack of camera-facing discs strung along its axis. A ribbon or a cone
 * shell both collapse when the axis points at the eye — which in a chase view is almost
 * always — whereas a stack of billboards reads as a plume from the side and as a glow
 * from behind, with no special case and no seam between the two.
 */
const STACK_VERT = /* glsl */ `
${PLUME_COMMON}
// Declared only here: an attribute in a fragment shader is a compile error, and the
// shared block above is included by both stages.
attribute float aStation;   // 0 at the throat, 1 at the tip of the plume
void main() {
  vT = aStation;
  vQuad = position.xy;
  vec3 originView = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  // The plume runs along the object's -Z.
  vec3 axisView = normalize((modelViewMatrix * vec4(0.0, 0.0, -1.0, 0.0)).xyz);
  // The plume also grows as the reheat lights rather than only brightening.
  vec3 centre = originView + axisView * (aStation * uLength * (0.55 + 0.45 * uAmount));
  vec3 p = centre + vec3(position.x, position.y, 0.0) * plumeWidth(aStation);
  gl_Position = projectionMatrix * vec4(p, 1.0);
}
`;

const FLAME_FRAG = /* glsl */ `
precision highp float;
${PLUME_COMMON}
uniform float uSlices;
void main() {
  float t = vT, r = length(vQuad);
  // Radial profile: solid core, soft edge.
  float radial = 1.0 - smoothstep(0.30, 1.0, r);
  if (radial <= 0.002) discard;

  // Turbulence grows downstream; near the throat the flow is still smooth.
  float turb = noise(vec3(r * 3.4, t * 9.0 - uTime * 26.0, uTime * 3.0));
  float turb2 = noise(vec3(r * 8.0 + 3.0, t * 22.0 - uTime * 44.0, uTime * 5.0));
  float shred = mix(1.0, 0.45 + 1.10 * (turb * 0.65 + turb2 * 0.35), smoothstep(0.10, 0.85, t));

  // Shock diamonds: bright nodes at a regular spacing that stretches with thrust.
  float spacing = mix(0.075, 0.125, uAmount);
  float diamond = pow(max(0.0, sin(t / spacing * 3.14159)), 16.0)
                * (1.0 - smoothstep(0.04, 0.62, t)) * (1.0 - smoothstep(0.10, 0.70, r));

  // Values above 1 are deliberate: this is an HDR buffer and bloom turns the excess
  // into glow.
  vec3 core  = vec3(1.45, 1.62, 2.00);
  vec3 mid   = vec3(0.42, 0.50, 1.05);
  vec3 outer = vec3(0.95, 0.34, 0.09);
  float coreMask = (1.0 - smoothstep(0.0, 0.24, t)) * (1.0 - smoothstep(0.0, 0.55, r));
  float midMask  = (1.0 - smoothstep(0.05, 0.86, t)) * (1.0 - smoothstep(0.15, 0.95, r));
  vec3 col = outer;
  col = mix(col, mid, clamp(midMask, 0.0, 1.0));
  col = mix(col, core, clamp(coreMask, 0.0, 1.0));
  col += core * diamond * 1.1;

  float axial = 1.0 - smoothstep(0.45, 1.0, t);
  float a = radial * axial * shred * uAmount;
  // Even dry, a hot nozzle glows a little.
  a = max(a, radial * (1.0 - smoothstep(0.0, 0.12, t)) * 0.20);
  // The slices overlap, so each contributes a fraction; the constant is what the stack
  // sums to through the densest part of the plume.
  a *= 11.0 / uSlices;
  if (a < 0.002) discard;
  gl_FragColor = vec4(col * a, a);
}
`;

const HEAT_FRAG = /* glsl */ `
precision highp float;
${PLUME_COMMON}
uniform float uSlices;
void main() {
  float t = vT, r = length(vQuad);
  float radial = 1.0 - smoothstep(0.20, 1.0, r);
  float n1 = noise(vec3(r * 2.2, t * 7.0 - uTime * 14.0, uTime * 2.0)) - 0.5;
  float n2 = noise(vec3(r * 5.4 + 7.0, t * 15.0 - uTime * 22.0, uTime * 3.7)) - 0.5;
  float strength = radial * smoothstep(0.02, 0.35, t) * (1.0 - smoothstep(0.72, 1.0, t))
                 * (0.35 + 0.65 * uAmount) * (7.0 / uSlices);
  // rg carries the screen-space offset, b its magnitude for the composite to weight by.
  gl_FragColor = vec4(n1 * strength, n2 * strength, strength, 1.0);
}
`;

/** A stack of quads with an `aStation` attribute running from the throat to the tip. */
function stackGeometry(slices: number): THREE.BufferGeometry {
  const pos: number[] = [], station: number[] = [], index: number[] = [];
  for (let i = 0; i < slices; i++) {
    // Bunch the slices toward the throat, where the plume changes fastest.
    const t = Math.pow(i / (slices - 1), 1.35);
    const base = i * 4;
    pos.push(-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0);
    for (let k = 0; k < 4; k++) station.push(t);
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aStation', new THREE.BufferAttribute(new Float32Array(station), 1));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}

export class Afterburner extends THREE.Group {
  private materials: THREE.ShaderMaterial[] = [];
  private lights: THREE.PointLight[] = [];
  private uniforms: Record<string, THREE.IUniform>;
  private time = 0;

  constructor(exits: THREE.Vector3[], radius = 0.58, length = 11) {
    super();
    const SLICES = 22;
    this.uniforms = {
      uAmount: { value: 0 }, uTime: { value: 0 },
      uLength: { value: length }, uRadius: { value: radius }, uSlices: { value: SLICES },
    };
    const geo = stackGeometry(SLICES);

    const mk = (frag: string, heat: boolean) => {
      const m = new THREE.ShaderMaterial({
        vertexShader: STACK_VERT, fragmentShader: frag,
        uniforms: { ...this.uniforms },
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        blending: heat ? THREE.NormalBlending : THREE.AdditiveBlending,
      });
      this.materials.push(m);
      return m;
    };

    for (const exit of exits) {
      const add = (mat: THREE.ShaderMaterial, layer: number | null) => {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(exit);
        mesh.frustumCulled = false;
        mesh.renderOrder = 15;
        if (layer !== null) mesh.layers.set(layer);
        this.add(mesh);
      };
      add(mk(FLAME_FRAG, false), null);
      add(mk(HEAT_FRAG, true), HEAT_LAYER);

      // Throws light on the tail booms, and on the ground during the take-off roll.
      const light = new THREE.PointLight(0xff8a3a, 0, 60, 2);
      light.position.copy(exit).add(new THREE.Vector3(0, 0, -1.6));
      this.add(light);
      this.lights.push(light);
    }
  }

  update(dt: number, s: FlightState, night: number) {
    this.time += dt;
    // Visible plume: mostly the afterburner, with a hot glow at high dry power too.
    const amount = Math.min(1, s.afterburner * 0.92 + Math.max(0, s.throttle - 0.55) * 0.22);
    for (const m of this.materials) {
      m.uniforms.uAmount.value = amount;
      m.uniforms.uTime.value = this.time;
    }
    this.visible = amount > 0.01;
    // Flicker: reheat is not steady.
    const flicker = 0.85 + 0.15 * Math.sin(this.time * 47) * Math.sin(this.time * 31 + 1.3);
    for (const l of this.lights) {
      l.intensity = amount * amount * 460 * flicker * (0.40 + 0.60 * night);
      l.distance = 30 + 45 * amount;
    }
  }
}
