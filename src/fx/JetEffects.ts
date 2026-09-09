import * as THREE from 'three';
import { FlightState } from '../aircraft/FlightModel';
import { clamp, smoothstep } from '../core/Noise';

/**
 * The condensation effects that belong to a fast aeroplane.
 *
 * All of them are the same physics seen three ways: air that has been accelerated
 * around the airframe drops in pressure, and therefore in temperature, until the water
 * in it condenses. Where that happens depends on speed.
 *
 *   * Transonic cone — near Mach 1 the whole aircraft sits inside a shock system and
 *     the condensation forms a bell around it. Modelled as a cone that opens as the
 *     Mach angle demands, appearing only in the narrow band where it really occurs.
 *   * Wing vapour — in a hard turn the upper surface goes far enough below ambient for
 *     a sheet of vapour to sit on it. Modelled as a thin shell over the wing whose
 *     opacity follows load factor and humidity.
 *
 * Both are drawn as additive shells with a soft, view-dependent falloff, which is what
 * stops them reading as solid geometry.
 */
const SHELL_VERT = /* glsl */ `
varying vec3 vLocalPos;
varying vec3 vViewDir;
varying vec3 vWorldNormal;
void main() {
  vLocalPos = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vViewDir = normalize(cameraPosition - wp.xyz);
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const CONE_FRAG = /* glsl */ `
precision highp float;
uniform float uAmount;
uniform float uTime;
uniform float uLength;
varying vec3 vLocalPos;
varying vec3 vViewDir;
varying vec3 vWorldNormal;
float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
void main() {
  if (uAmount <= 0.001) discard;
  float t = clamp(-vLocalPos.z / uLength, 0.0, 1.0);
  // Densest at the waist of the bell, thinning fore and aft.
  float band = smoothstep(0.02, 0.30, t) * (1.0 - smoothstep(0.55, 1.0, t));
  // Grazing angles see the most vapour, as with any thin shell.
  float rim = 1.0 - abs(dot(normalize(vViewDir), normalize(vWorldNormal)));
  float wisp = noise(vLocalPos * vec3(2.2, 2.2, 0.9) + vec3(0.0, 0.0, uTime * 3.0));
  float a = band * pow(rim, 1.35) * (0.55 + 0.75 * wisp) * uAmount;
  gl_FragColor = vec4(vec3(0.92, 0.95, 1.0) * a, a);
}`;

const WING_FRAG = /* glsl */ `
precision highp float;
uniform float uAmount;
uniform float uTime;
varying vec3 vLocalPos;
varying vec3 vViewDir;
varying vec3 vWorldNormal;
float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
void main() {
  if (uAmount <= 0.001) discard;
  // Vapour sits on the upper surface only, strongest just aft of the leading edge.
  float upper = smoothstep(0.1, 0.7, vWorldNormal.y);
  float chord = smoothstep(0.0, 0.35, vLocalPos.z + 0.5) * (1.0 - smoothstep(0.4, 1.0, vLocalPos.z + 0.5));
  float rim = 1.0 - abs(dot(normalize(vViewDir), normalize(vWorldNormal)));
  float wisp = noise(vLocalPos * 4.5 + vec3(uTime * 2.2, 0.0, 0.0));
  float a = upper * (0.35 + 0.65 * chord) * (0.35 + 0.75 * rim) * (0.5 + 0.8 * wisp) * uAmount;
  gl_FragColor = vec4(vec3(0.94, 0.96, 1.0) * a, a);
}`;

export class JetEffects extends THREE.Group {
  private cone: THREE.Mesh;
  private coneMat: THREE.ShaderMaterial;
  private wings: THREE.Mesh[] = [];
  private wingMat: THREE.ShaderMaterial;
  private time = 0;

  constructor(span: number, length: number) {
    super();
    const uniforms = { uAmount: { value: 0 }, uTime: { value: 0 }, uLength: { value: length * 0.75 } };
    this.coneMat = new THREE.ShaderMaterial({
      vertexShader: SHELL_VERT, fragmentShader: CONE_FRAG, uniforms,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const coneGeo = new THREE.CylinderGeometry(length * 0.10, length * 0.34, length * 0.75, 28, 10, true);
    coneGeo.rotateX(Math.PI / 2);
    coneGeo.translate(0, 0, -length * 0.30);
    this.cone = new THREE.Mesh(coneGeo, this.coneMat);
    this.cone.frustumCulled = false;
    this.cone.renderOrder = 14;
    this.add(this.cone);

    this.wingMat = new THREE.ShaderMaterial({
      vertexShader: SHELL_VERT, fragmentShader: WING_FRAG,
      uniforms: { uAmount: { value: 0 }, uTime: { value: 0 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    // A shallow shell sitting a few centimetres above each wing panel.
    for (const sign of [1, -1]) {
      const g = new THREE.PlaneGeometry(span * 0.34, length * 0.22, 12, 6);
      g.rotateX(-Math.PI / 2);
      // Bow it upward slightly so the shell has a surface normal to catch the rim term.
      const pos = g.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i) / (span * 0.17);
        pos.setY(i, 0.10 * (1 - x * x));
      }
      g.computeVertexNormals();
      g.translate(sign * span * 0.24, 0.16, -length * 0.02);
      const m = new THREE.Mesh(g, this.wingMat);
      m.frustumCulled = false;
      m.renderOrder = 14;
      this.add(m);
      this.wings.push(m);
    }
    this.visible = false;
  }

  update(dt: number, s: FlightState) {
    this.time += dt;
    this.coneMat.uniforms.uTime.value = this.time;
    this.wingMat.uniforms.uTime.value = this.time;

    // The cone lives in a narrow band either side of Mach 1, and needs moist air, so it
    // is a low-level phenomenon.
    const machBand = smoothstep(0.92, 0.985, s.mach) * (1 - smoothstep(1.02, 1.14, s.mach));
    const humid = 1 - smoothstep(1500, 5000, s.altitude);
    const coneAmount = machBand * humid * 0.9;
    this.coneMat.uniforms.uAmount.value = coneAmount;
    this.cone.visible = coneAmount > 0.004;

    // Wing vapour: load factor above about 4 g, again only in moist air, and it needs
    // enough dynamic pressure to have somewhere to condense.
    const g = clamp((Math.abs(s.gLoad) - 3.4) / 3.2, 0, 1);
    const wingAmount = g * (1 - smoothstep(2500, 6500, s.altitude)) * smoothstep(90, 170, s.airspeed) * 0.85;
    this.wingMat.uniforms.uAmount.value = wingAmount;
    for (const w of this.wings) w.visible = wingAmount > 0.004;

    this.visible = this.cone.visible || wingAmount > 0.004;
  }
}
