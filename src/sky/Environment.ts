import * as THREE from 'three';

/**
 * Dynamic image-based lighting: renders the procedural sky into a small cubemap and
 * runs it through PMREM whenever the sun moves, so every PBR material is lit by the
 * exact sky it is standing under (blue-ish ambient at noon, orange at dusk).
 */
export class DynamicEnvironment {
  private cubeRT: THREE.WebGLCubeRenderTarget;
  private cubeCam: THREE.CubeCamera;
  private pmrem: THREE.PMREMGenerator;
  private envScene = new THREE.Scene();
  private current: THREE.Texture | null = null;
  private dirty = true;

  constructor(private renderer: THREE.WebGLRenderer) {
    this.cubeRT = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType, generateMipmaps: false });
    this.cubeCam = new THREE.CubeCamera(1, 100000, this.cubeRT);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmrem.compileCubemapShader();
  }

  invalidate() { this.dirty = true; }

  /** Call once per frame; does the (expensive) bake only when needed. */
  update(scene: THREE.Scene, skyMesh: THREE.Object3D) {
    if (!this.dirty) return;
    this.dirty = false;
    // The sky mesh lives in the main scene; temporarily borrow it.
    const parent = skyMesh.parent;
    this.envScene.add(skyMesh);
    skyMesh.position.set(0, 0, 0);
    this.cubeCam.position.set(0, 50, 0);
    this.cubeCam.update(this.renderer, this.envScene);
    const env = this.pmrem.fromCubemap(this.cubeRT.texture);
    if (this.current) this.current.dispose();
    this.current = env.texture;
    scene.environment = env.texture;
    parent?.add(skyMesh);
  }
}
