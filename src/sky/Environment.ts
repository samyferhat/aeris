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
  /** Average sky radiance looking up / at the horizon (read back after each bake). */
  readonly skyTop = new THREE.Color(0.2, 0.4, 0.8);
  readonly skyHorizon = new THREE.Color(0.5, 0.6, 0.8);
  private px = new Float32Array(4 * 16);

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
    // Read back a few texels for cloud ambient lighting (faces: 0 +X, 1 -X, 2 +Y, 3 -Y, 4 +Z, 5 -Z)
    const rt = this.cubeRT, n = rt.width;
    const avg = (face: number, y0: number) => {
      this.renderer.readRenderTargetPixels(rt, n / 2 - 2, y0, 4, 4, this.px, face);
      let r = 0, g = 0, b = 0; for (let i = 0; i < 16; i++) { r += this.px[i * 4]; g += this.px[i * 4 + 1]; b += this.px[i * 4 + 2]; }
      return [r / 16, g / 16, b / 16];
    };
    const top = avg(2, n / 2 - 2);
    this.skyTop.setRGB(top[0], top[1], top[2]);
    let hr = 0, hg = 0, hb = 0;
    for (const f of [0, 1, 4, 5]) { const c = avg(f, n / 2 + 4); hr += c[0]; hg += c[1]; hb += c[2]; }
    this.skyHorizon.setRGB(hr / 4, hg / 4, hb / 4);
    const env = this.pmrem.fromCubemap(this.cubeRT.texture);
    if (this.current) this.current.dispose();
    this.current = env.texture;
    scene.environment = env.texture;
    parent?.add(skyMesh);
  }
}
