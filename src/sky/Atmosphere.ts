import * as THREE from 'three';
import atmosphereChunk from '../shaders/atmosphere.glsl?raw';
import skyVert from '../shaders/sky.vert.glsl?raw';
import skyFrag from '../shaders/sky.frag.glsl?raw';
import { clamp, smoothstep, lerp } from '../core/Noise';

// Register the shared chunk so any shader can `#include <atmosphere>`.
(THREE.ShaderChunk as any).atmosphere = atmosphereChunk;

/** Uniforms shared by every shader that does atmospheric scattering. */
export const atmoUniforms = {
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunIntensity: { value: 22.0 },
  uMieCoeff: { value: 6e-6 },
  uMieG: { value: 0.76 },
  uHazeAmount: { value: 0.25 },
};

/**
 * Time of day -> sun position, sun/ambient colours (CPU-side estimate matching the
 * GLSL model), sky dome mesh.  Latitude 38°N, mid-June declination.
 */
export class Atmosphere {
  readonly sky: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  readonly sunColor = new THREE.Color();
  readonly moonDir = new THREE.Vector3(0.3, 0.6, -0.7).normalize();
  hour = 10.5;
  /** 0 = day, 1 = night */
  night = 0;
  sunElevation = 0;

  constructor(starsHdr: THREE.Texture) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      uniforms: {
        ...atmoUniforms,
        uStars: { value: starsHdr },
        uNight: { value: 0 },
        uStarsRotation: { value: 0 },
        uSunDiscScale: { value: 1.0 },
      },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.material);
    this.sky.scale.setScalar(50000);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;
    this.setHour(this.hour);
  }

  setHour(h: number) {
    this.hour = ((h % 24) + 24) % 24;
    const lat = THREE.MathUtils.degToRad(38);
    const decl = THREE.MathUtils.degToRad(21);
    const H = (this.hour - 13.0) / 24 * Math.PI * 2; // solar noon at 13:00
    const sinEl = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H);
    const el = Math.asin(sinEl);
    const cosAz = (Math.sin(decl) - Math.sin(el) * Math.sin(lat)) / (Math.cos(el) * Math.cos(lat));
    let az = Math.acos(clamp(cosAz, -1, 1));
    if (H > 0) az = 2 * Math.PI - az;
    // az: 0 = north, clockwise. World: +X east, -Z north.
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    this.sunElevation = el;
    atmoUniforms.uSunDir.value.copy(this.sunDir);
    this.night = 1 - smoothstep(-0.16, -0.02, el);
    this.material.uniforms.uNight.value = this.night;
    this.material.uniforms.uStarsRotation.value = this.hour / 24 * Math.PI * 2;
    // Haze: strongest at dawn, then burns off.
    atmoUniforms.uHazeAmount.value = lerp(0.12, 0.55, smoothstep(0.35, 0.0, Math.abs(this.hour - 6.5) / 4));
    atmoUniforms.uMieCoeff.value = lerp(4e-6, 1.2e-5, smoothstep(0.2, -0.05, el));
    this.computeSunColor();
  }

  /** Approximate transmittance-tinted sun colour (matches the GLSL Rayleigh/Mie coefficients). */
  private computeSunColor() {
    const el = this.sunElevation;
    // Chapman-like air-mass approximation
    const zenith = Math.max(0, Math.PI / 2 - el);
    const airMass = 1 / (Math.cos(zenith) + 0.15 * Math.pow(93.885 - THREE.MathUtils.radToDeg(zenith), -1.253));
    const am = el > 0 ? clamp(airMass, 1, 38) : 38;
    const betaR = [5.8e-6, 13.5e-6, 33.1e-6];
    const mie = atmoUniforms.uMieCoeff.value * 1.1;
    const c = betaR.map((b) => Math.exp(-(b * 8000 + mie * 1200) * am));
    const vis = smoothstep(-0.02, 0.03, el);
    this.sunColor.setRGB(c[0] * vis, c[1] * vis, c[2] * vis);
  }

  /** Sun light intensity (lux-ish scale for the DirectionalLight). */
  get sunIntensity(): number { return 3.2 * smoothstep(-0.03, 0.12, this.sunElevation); }

  update(camera: THREE.Camera) {
    this.sky.position.copy(camera.position);
  }
}
