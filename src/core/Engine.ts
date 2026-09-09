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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.78;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }

  setupShadows(camera: THREE.Camera) {
    this.csm = new CSM({
      camera, parent: this.scene, cascades: 3, maxFar: 2600, mode: 'practical', shadowMapSize: 2048,
      lightDirection: new THREE.Vector3(0.3, -1, 0.2).normalize(), lightIntensity: 3, shadowBias: -0.00015, lightMargin: 300,
    });
    this.csm.fade = true;
    for (const l of this.csm.lights) { l.shadow.normalBias = 0.6; l.shadow.radius = 2; }
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
