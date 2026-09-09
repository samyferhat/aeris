import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';

/**
 * Renderer + scene + cascaded shadow maps. Post-processing lives in fx/PostProcessing.
 */
export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly clock = new THREE.Clock();
  csm!: CSM;
  readonly sunTarget = new THREE.Vector3();

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true, logarithmicDepthBuffer: false });
    // 2x on a retina panel means four million pixels through a raymarcher; 1.5 keeps the
    // image crisp and buys back nearly half the fill cost. Adaptive scaling handles the rest.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Tone mapping is done in the pipeline's own pass, which needs the exposure to come
    // from a texture (the eye-adaptation state) rather than a CPU uniform.
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }

  setupShadows(camera: THREE.Camera) {
    // Custom splits rather than 'practical': the aircraft is always within ~30 m of the
    // camera and its shadow is the one the eye checks, so the first cascade is kept very
    // tight (~2 cm per texel) while the last still reaches the far ridges.
    this.csm = new CSM({
      camera, parent: this.scene, cascades: 3, maxFar: 2200, mode: 'custom', shadowMapSize: 1024,
      customSplitsCallback: (cascades, near, far, target) => {
        const t = [0.02, 0.11, 1.0];
        for (let i = 0; i < cascades; i++) target.push(t[i] ?? (i + 1) / cascades);
      },
      lightDirection: new THREE.Vector3(0.3, -1, 0.2).normalize(), lightIntensity: 3,
      shadowBias: -0.00008, lightMargin: 400, lightFar: 3000,
    });
    this.csm.fade = true;
    for (const l of this.csm.lights) { l.shadow.normalBias = 0.25; l.shadow.radius = 1.6; }
  }

  /**
   * CSM.setupMaterial overwrites `onBeforeCompile`; this wrapper keeps the material's own
   * shader patches (terrain blending, ocean, aerial perspective) and adds the CSM uniforms.
   */
  setupShadowMaterial(material: THREE.Material) {
    const own = material.onBeforeCompile;
    this.csm.setupMaterial(material);
    const csmHook = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      own?.call(material, shader, renderer);
      csmHook.call(material, shader, renderer);
    };
    const key = (material as any).customProgramCacheKey;
    material.customProgramCacheKey = () => 'csm' + (key ? key.call(material) : '');
  }

  setSun(dir: THREE.Vector3, color: THREE.Color, intensity: number) {
    this.csm.lightDirection.copy(dir).multiplyScalar(-1);
    for (const l of this.csm.lights) { l.color.copy(color); l.intensity = intensity; }
  }

  resize(camera: THREE.PerspectiveCamera) {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    this.csm?.updateFrustums();
  }
}
