import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { atmoUniforms } from '../sky/Atmosphere';
import { makeCloudShapeTexture, makeCloudDetailTexture, makeWeatherTexture } from '../sky/CloudNoise';
import cloudsFrag from '../shaders/clouds.frag.glsl?raw';
import { fsVert, aoFrag, aoBlurFrag, godMaskFrag, godBlurFrag, compositeFrag, motionBlurFrag, dofFrag, grainFrag } from '../shaders/post.glsl';

/**
 * Custom HDR pipeline sharing one depth texture:
 *   scene ─► clouds (½ res raymarch) ─► god rays (¼ res) ─► AO (½ res)
 *         ─► composite (+ lens flare) ─► motion blur ─► bloom ─► DoF (cockpit)
 *         ─► tone mapping (ACES) ─► FXAA ─► grain & vignette ─► screen
 */
export class Pipeline {
  private sceneRT: THREE.WebGLRenderTarget;
  private cloudRT: THREE.WebGLRenderTarget;
  private aoRT: THREE.WebGLRenderTarget;
  private aoRT2: THREE.WebGLRenderTarget;
  private godRT: THREE.WebGLRenderTarget;
  private godRT2: THREE.WebGLRenderTarget;
  private pingRT: THREE.WebGLRenderTarget;
  private pongRT: THREE.WebGLRenderTarget;
  private ldrRT: THREE.WebGLRenderTarget;
  private ldrRT2: THREE.WebGLRenderTarget;
  private depth: THREE.DepthTexture;
  private quad = new FullScreenQuad();
  private cloudMat: THREE.ShaderMaterial;
  private aoMat: THREE.ShaderMaterial;
  private aoBlurMat: THREE.ShaderMaterial;
  private godMaskMat: THREE.ShaderMaterial;
  private godBlurMat: THREE.ShaderMaterial;
  private compositeMat: THREE.ShaderMaterial;
  private motionMat: THREE.ShaderMaterial;
  private dofMat: THREE.ShaderMaterial;
  private grainMat: THREE.ShaderMaterial;
  private bloom: UnrealBloomPass;
  private output = new OutputPass();
  private fxaa = new FXAAPass();
  private prevViewProj = new THREE.Matrix4();
  private frame = 0;
  private w = 1; private h = 1;

  /** Debug: show an intermediate buffer instead of the final image. */
  debugView: 'clouds' | 'ao' | 'god' | 'depth' | null = null;
  private debugMat = new THREE.ShaderMaterial({ vertexShader: fsVert, fragmentShader: `precision highp float; uniform sampler2D tDiffuse; uniform int uMode; varying vec2 vUv; void main(){ vec4 c = texture2D(tDiffuse, vUv); if (uMode == 1) c = vec4(c.rgb + vec3(1.0 - c.a) * vec3(0.0, 0.0, 0.3), 1.0); if (uMode == 3) c = vec4(vec3(pow(c.x, 40.0)), 1.0); gl_FragColor = vec4(c.rgb, 1.0); }`, uniforms: { tDiffuse: { value: null }, uMode: { value: 0 } }, depthTest: false, depthWrite: false });
  // Public knobs
  cloudCoverage = 0.42;
  /** Live-tunable cloud density shaping (see clouds.frag.glsl). */
  cloudDensity = { bias: 0.82, slope: 0.75, scale: 1.0 };
  cloudBase = 950; cloudTop = 1750;
  dofEnabled = false;
  motionBlur = 0.35;
  time = 0;
  sunScreen = new THREE.Vector2(0.5, 0.5);
  sunVisible = 0;
  readonly sunColor = new THREE.Color(1, 1, 1);
  readonly ambientTop = new THREE.Color(0.3, 0.5, 0.9);
  readonly ambientBottom = new THREE.Color(0.35, 0.4, 0.5);

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private camera: THREE.PerspectiveCamera) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.w = size.x; this.h = size.y;
    this.depth = new THREE.DepthTexture(size.x, size.y, THREE.FloatType);
    this.depth.format = THREE.DepthFormat;
    const hdr = (w: number, h: number, depth = false) => {
      const opts: THREE.RenderTargetOptions = { type: THREE.HalfFloatType, depthBuffer: depth, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, samples: 0 };
      if (depth) opts.depthTexture = this.depth;
      return new THREE.WebGLRenderTarget(w, h, opts);
    };
    this.sceneRT = hdr(size.x, size.y, true);
    this.pingRT = hdr(size.x, size.y); this.pongRT = hdr(size.x, size.y);
    this.cloudRT = hdr(size.x >> 1, size.y >> 1);
    this.aoRT = new THREE.WebGLRenderTarget(size.x >> 1, size.y >> 1, { type: THREE.UnsignedByteType, depthBuffer: false });
    this.aoRT2 = this.aoRT.clone();
    this.godRT = new THREE.WebGLRenderTarget(size.x >> 2, size.y >> 2, { type: THREE.HalfFloatType, depthBuffer: false });
    this.godRT2 = this.godRT.clone();
    this.ldrRT = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.UnsignedByteType, depthBuffer: false });
    this.ldrRT2 = this.ldrRT.clone();

    const mk = (frag: string, uniforms: Record<string, THREE.IUniform>) => new THREE.ShaderMaterial({ vertexShader: fsVert, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
    this.cloudMat = mk(cloudsFrag.replace('#include <atmosphere>', (THREE.ShaderChunk as any).atmosphere), {
      ...atmoUniforms, tDepth: { value: this.depth }, tShape: { value: makeCloudShapeTexture(64) }, tDetail: { value: makeCloudDetailTexture(32) }, tWeather: { value: makeWeatherTexture(256) },
      uInvProjection: { value: new THREE.Matrix4() }, uInvView: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
      uNear: { value: camera.near }, uFar: { value: camera.far }, uTime: { value: 0 }, uCoverage: { value: this.cloudCoverage },
      uCloudBase: { value: this.cloudBase }, uCloudTop: { value: this.cloudTop },
      uDensityBias: { value: 0.82 }, uDensitySlope: { value: 0.75 }, uDensityScale: { value: 1.0 }, uAmbientTop: { value: this.ambientTop }, uAmbientBottom: { value: this.ambientBottom },
      uSunColor: { value: this.sunColor }, uWind: { value: new THREE.Vector2(1, 0.3) }, uResolution: { value: new THREE.Vector2(size.x >> 1, size.y >> 1) }, uFrame: { value: 0 },
    });
    // No glslVersion override: three.js already compiles every shader as `#version 300 es`
    // with GLSL1 compatibility defines, so `sampler3D` / `texture()` work as-is.

    this.aoMat = mk(aoFrag, { tDepth: { value: this.depth }, uNear: { value: camera.near }, uFar: { value: camera.far }, uInvProjection: { value: new THREE.Matrix4() }, uProjection: { value: new THREE.Matrix4() }, uTexel: { value: new THREE.Vector2(1 / (size.x >> 1), 1 / (size.y >> 1)) }, uRadius: { value: 0.9 }, uFrame: { value: 0 } });
    this.aoBlurMat = mk(aoBlurFrag, { tAO: { value: null }, tDepth: { value: this.depth }, uDir: { value: new THREE.Vector2() } });
    this.godMaskMat = mk(godMaskFrag, { tDepth: { value: this.depth }, tClouds: { value: this.cloudRT.texture }, uSunScreen: { value: this.sunScreen }, uSunVisible: { value: 0 } });
    this.godBlurMat = mk(godBlurFrag, { tMask: { value: null }, uSunScreen: { value: this.sunScreen }, uDensity: { value: 0.9 }, uDecay: { value: 0.93 } });
    this.compositeMat = mk(compositeFrag, {
      tScene: { value: this.sceneRT.texture }, tClouds: { value: this.cloudRT.texture }, tDepth: { value: this.depth }, tGod: { value: this.godRT.texture }, tAO: { value: this.aoRT.texture },
      uHalfTexel: { value: new THREE.Vector2(1 / (size.x >> 1), 1 / (size.y >> 1)) }, uSunScreen: { value: this.sunScreen }, uSunVisible: { value: 0 }, uSunColor: { value: this.sunColor },
      uGodStrength: { value: 0.6 }, uAOStrength: { value: 0.5 }, uFlareStrength: { value: 0.5 }, uAspect: { value: size.x / size.y }, uNear: { value: camera.near }, uFar: { value: camera.far },
    });
    this.motionMat = mk(motionBlurFrag, { tDiffuse: { value: null }, tDepth: { value: this.depth }, uInvViewProj: { value: new THREE.Matrix4() }, uPrevViewProj: { value: new THREE.Matrix4() }, uStrength: { value: 0.35 }, uTexel: { value: new THREE.Vector2(1 / size.x, 1 / size.y) }, uNear: { value: camera.near }, uFar: { value: camera.far } });
    this.dofMat = mk(dofFrag, { tDiffuse: { value: null }, tDepth: { value: this.depth }, uTexel: { value: new THREE.Vector2(1 / size.x, 1 / size.y) }, uFocus: { value: 30 }, uMaxCoc: { value: 7 }, uNear: { value: camera.near }, uFar: { value: camera.far } });
    this.grainMat = mk(grainFrag, { tDiffuse: { value: null }, uTime: { value: 0 }, uAmount: { value: 0.045 }, uVignette: { value: 0.3 } });
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.22, 0.55, 1.15);
    this.output.setSize(size.x, size.y);
    this.fxaa.setSize(size.x, size.y);
  }

  setSize(w: number, h: number) {
    this.renderer.getDrawingBufferSize(new THREE.Vector2()); // ensure DPR applied by caller
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    w = size.x; h = size.y; this.w = w; this.h = h;
    this.sceneRT.setSize(w, h); this.pingRT.setSize(w, h); this.pongRT.setSize(w, h); this.ldrRT.setSize(w, h); this.ldrRT2.setSize(w, h);
    this.cloudRT.setSize(w >> 1, h >> 1); this.aoRT.setSize(w >> 1, h >> 1); this.aoRT2.setSize(w >> 1, h >> 1);
    this.godRT.setSize(w >> 2, h >> 2); this.godRT2.setSize(w >> 2, h >> 2);
    this.cloudMat.uniforms.uResolution.value.set(w >> 1, h >> 1);
    this.aoMat.uniforms.uTexel.value.set(1 / (w >> 1), 1 / (h >> 1));
    this.compositeMat.uniforms.uHalfTexel.value.set(1 / (w >> 1), 1 / (h >> 1));
    this.compositeMat.uniforms.uAspect.value = w / h;
    this.motionMat.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.dofMat.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.bloom.setSize(w, h); this.output.setSize(w, h); this.fxaa.setSize(w, h);
  }

  private blit(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.quad.render(this.renderer);
  }

  /** Sun position on screen + visibility (for god rays and flare). */
  private updateSun() {
    const dir = atmoUniforms.uSunDir.value;
    const p = this.camera.position.clone().addScaledVector(dir, 1000).project(this.camera);
    const behind = p.z > 1 || p.z < -1;
    this.sunScreen.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
    const inside = !behind && p.x > -1.3 && p.x < 1.3 && p.y > -1.3 && p.y < 1.3;
    const edge = inside ? Math.min(1, (1.3 - Math.max(Math.abs(p.x), Math.abs(p.y))) / 0.3) : 0;
    const target = edge * Math.max(0, Math.min(1, (dir.y + 0.02) / 0.06));
    this.sunVisible += (target - this.sunVisible) * 0.2;
  }

  render(dt: number, mode: 'chase' | 'cockpit' | 'orbit') {
    const r = this.renderer, cam = this.camera;
    this.frame++; this.time += dt;
    this.updateSun();
    // 1. scene
    r.setRenderTarget(this.sceneRT);
    r.render(this.scene, cam);
    // 2. clouds
    const cu = this.cloudMat.uniforms;
    cu.uInvProjection.value.copy(cam.projectionMatrixInverse);
    cu.uInvView.value.copy(cam.matrixWorld);
    cu.uCamPos.value.copy(cam.position);
    cu.uNear.value = cam.near; cu.uFar.value = cam.far;
    cu.uTime.value = this.time; cu.uFrame.value = this.frame;
    cu.uCoverage.value = this.cloudCoverage; cu.uCloudBase.value = this.cloudBase; cu.uCloudTop.value = this.cloudTop;
    cu.uDensityBias.value = this.cloudDensity.bias; cu.uDensitySlope.value = this.cloudDensity.slope; cu.uDensityScale.value = this.cloudDensity.scale;
    this.blit(this.cloudMat, this.cloudRT);
    // 3. god rays
    this.godMaskMat.uniforms.uSunVisible.value = this.sunVisible;
    this.blit(this.godMaskMat, this.godRT2);
    this.godBlurMat.uniforms.tMask.value = this.godRT2.texture; this.blit(this.godBlurMat, this.godRT);
    this.godBlurMat.uniforms.tMask.value = this.godRT.texture; this.blit(this.godBlurMat, this.godRT2);
    this.godBlurMat.uniforms.tMask.value = this.godRT2.texture; this.blit(this.godBlurMat, this.godRT);
    // 4. AO
    const au = this.aoMat.uniforms;
    au.uInvProjection.value.copy(cam.projectionMatrixInverse); au.uProjection.value.copy(cam.projectionMatrix);
    au.uNear.value = cam.near; au.uFar.value = cam.far; au.uFrame.value = this.frame;
    this.blit(this.aoMat, this.aoRT2);
    this.aoBlurMat.uniforms.tAO.value = this.aoRT2.texture; this.aoBlurMat.uniforms.uDir.value.set(1 / (this.w >> 1), 0); this.blit(this.aoBlurMat, this.aoRT);
    this.aoBlurMat.uniforms.tAO.value = this.aoRT.texture; this.aoBlurMat.uniforms.uDir.value.set(0, 1 / (this.h >> 1)); this.blit(this.aoBlurMat, this.aoRT2);
    this.compositeMat.uniforms.tAO.value = this.aoRT2.texture;
    // 5. composite (+flare)
    this.compositeMat.uniforms.uSunVisible.value = this.sunVisible;
    this.compositeMat.uniforms.uNear.value = cam.near; this.compositeMat.uniforms.uFar.value = cam.far;
    this.blit(this.compositeMat, this.pingRT);
    // 6. motion blur
    const mu = this.motionMat.uniforms;
    const viewProj = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    mu.uInvViewProj.value.copy(viewProj).invert();
    mu.uPrevViewProj.value.copy(this.prevViewProj);
    mu.uStrength.value = this.motionBlur; mu.tDiffuse.value = this.pingRT.texture;
    mu.uNear.value = cam.near; mu.uFar.value = cam.far;
    this.prevViewProj.copy(viewProj);
    this.blit(this.motionMat, this.pongRT);
    // 7. bloom (adds into pongRT)
    this.bloom.render(r, null as any, this.pongRT, dt, false);
    // 8. DoF (cockpit)
    let hdrOut = this.pongRT;
    if (mode === 'cockpit' && this.dofEnabled) {
      this.dofMat.uniforms.tDiffuse.value = this.pongRT.texture; this.dofMat.uniforms.uNear.value = cam.near; this.dofMat.uniforms.uFar.value = cam.far;
      this.blit(this.dofMat, this.pingRT); hdrOut = this.pingRT;
    }
    // 9. tone mapping → LDR
    this.output.render(r, this.ldrRT, hdrOut, dt, false);
    // 10. FXAA
    this.fxaa.render(r, this.ldrRT2, this.ldrRT, dt, false);
    // 11. grain to screen
    this.grainMat.uniforms.tDiffuse.value = this.ldrRT2.texture; this.grainMat.uniforms.uTime.value = this.time;
    if (this.debugView) {
      const map = { clouds: [this.cloudRT.texture, 1], ao: [this.aoRT2.texture, 0], god: [this.godRT.texture, 0], depth: [this.depth, 3] } as const;
      const [tex, mode] = map[this.debugView];
      this.debugMat.uniforms.tDiffuse.value = tex; this.debugMat.uniforms.uMode.value = mode;
      this.blit(this.debugMat, null);
      return;
    }
    this.blit(this.grainMat, null);
  }
}
