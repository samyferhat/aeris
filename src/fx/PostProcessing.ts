import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/** Film grain + vignette, applied after tone mapping. */
const GrainShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uAmount: { value: 0.035 }, uVignette: { value: 0.28 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime; uniform float uAmount; uniform float uVignette; varying vec2 vUv;
    float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float g = hash(vUv * 1000.0 + fract(uTime) * 100.0) - 0.5;
      float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb += g * uAmount * (1.0 - lum * 0.7);
      vec2 d = vUv - 0.5; float v = 1.0 - dot(d, d) * uVignette * 2.2;
      c.rgb *= smoothstep(0.0, 1.0, v);
      gl_FragColor = c; }`,
};

export class PostProcessing {
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  readonly grain: ShaderPass;
  readonly fxaa: FXAAPass;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    const size = renderer.getSize(new THREE.Vector2());
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(size, 0.35, 0.6, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grain = new ShaderPass(GrainShader);
    this.composer.addPass(this.grain);
    this.fxaa = new FXAAPass();
    this.composer.addPass(this.fxaa);
  }

  resize(w: number, h: number) { this.composer.setSize(w, h); }

  render(dt: number) {
    this.grain.uniforms.uTime.value += dt;
    this.composer.render(dt);
  }
}
