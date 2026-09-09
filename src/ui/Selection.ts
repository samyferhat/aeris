import * as THREE from 'three';
import { AircraftConfig } from '../aircraft/AircraftConfig';
import { atmoUniforms } from '../sky/Atmosphere';

/**
 * Pre-flight aircraft chooser.
 *
 * Two cards, each showing the real aeroplane turning slowly under studio light rather
 * than a rendered thumbnail: same renderer, same materials, a scissored viewport per
 * card. The lighting is a three-point studio rig plus the sky environment, which is
 * what makes a white Cessna read as white and a matte camouflage read as matte.
 */
export class Selection {
  private root: HTMLElement;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private rigs: { config: AircraftConfig; pivot: THREE.Group; radius: number }[] = [];
  private time = 0;
  private hovered = 0;
  private resolve: ((id: string) => void) | null = null;
  private done = false;
  /** Card rectangles in CSS pixels, refreshed from the DOM each frame. */
  private rects: DOMRect[] = [];
  private prevClear = new THREE.Color();
  private prevAlpha = 1;
  private prevToneMapping: THREE.ToneMapping = THREE.NoToneMapping;
  private prevExposure = 1;
  private prevCloudShadow = 0;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private environment: THREE.Texture | null,
    entries: { config: AircraftConfig; object: THREE.Object3D }[],
  ) {
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
    this.scene.environment = environment;
    this.scene.environmentIntensity = 1.25;

    // Three-point studio rig: a key from front-left high, a cool fill opposite, and a
    // rim from behind to separate the silhouette from the background.
    const key = new THREE.DirectionalLight(0xfff2e0, 5.2);
    key.position.set(-4, 5, 6);
    const fill = new THREE.DirectionalLight(0xbdd4ff, 2.0);
    fill.position.set(5, 1.5, 3);
    const rim = new THREE.DirectionalLight(0xffffff, 4.0);
    rim.position.set(2, 3, -7);
    this.scene.add(key, fill, rim);

    for (const { config, object } of entries) {
      const pivot = new THREE.Group();
      // Centre the model on its own bounding box so both aircraft turn about themselves.
      const box = new THREE.Box3().setFromObject(object);
      const centre = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      object.position.sub(centre);
      pivot.add(object);
      this.scene.add(pivot);
      this.rigs.push({ config, pivot, radius: Math.max(size.x, size.y, size.z) * 0.5 });
    }

    this.root = document.createElement('div');
    this.root.className = 'selection';
    this.root.innerHTML = `
      <div class="sel-head">
        <div class="sel-title">AERIS</div>
        <div class="sel-sub">Choisissez votre appareil</div>
      </div>
      <div class="sel-cards">
        ${this.rigs.map((r, i) => `
          <button class="sel-card" data-index="${i}" data-id="${r.config.id}">
            <div class="sel-stage"></div>
            <div class="sel-body">
            <div class="sel-meta">
              <div class="sel-name">${r.config.name}</div>
              <div class="sel-role">${r.config.subtitle}</div>
              <p class="sel-blurb">${r.config.blurb}</p>
              <dl class="sel-specs">
                <div><dt>Masse</dt><dd>${(r.config.mass / 1000).toFixed(1)} t</dd></div>
                <div><dt>Poussée</dt><dd>${Math.round(r.config.maxThrust * r.config.afterburnerBoost / 1000)} kN</dd></div>
                <div><dt>Approche</dt><dd>${r.config.approachSpeed} kt</dd></div>
              </dl>
            </div>
            <span class="sel-go">Décoller</span>
            </div>
          </button>`).join('')}
      </div>
      <div class="sel-foot">Flèches pour parcourir · Entrée pour valider</div>`;
    document.body.appendChild(this.root);
    // The previews are drawn into the canvas underneath, so the screen's backdrop has to
    // be painted by the renderer rather than by CSS or it would cover them.
    this.prevClear = renderer.getClearColor(new THREE.Color()).clone();
    this.prevAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x05070a, 1);
    // The flight pipeline does its own tone mapping in a fullscreen pass; this screen
    // renders straight to the canvas, so it needs the renderer's own.
    this.prevToneMapping = renderer.toneMapping;
    this.prevExposure = renderer.toneMappingExposure;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    // The airframes carry the world's cloud-shadow term; under studio light there are
    // no clouds, so silence it rather than let a stray sample darken a card.
    this.prevCloudShadow = atmoUniforms.uCsStrength.value;
    atmoUniforms.uCsStrength.value = 0;
    // The flight HUD and the time slider belong to the flight, not to this screen.
    document.getElementById('hud')?.classList.add('hidden');
    document.querySelector('.timectl')?.classList.add('hidden');

    this.root.querySelectorAll<HTMLElement>('.sel-card').forEach((card, i) => {
      card.addEventListener('pointerenter', () => this.setHovered(i));
      card.addEventListener('click', () => this.choose(i));
    });
    window.addEventListener('keydown', this.onKey);
    this.setHovered(0);
  }

  private onKey = (e: KeyboardEvent) => {
    if (this.done) return;
    if (e.code === 'ArrowLeft' || e.code === 'ArrowUp') { this.setHovered((this.hovered + this.rigs.length - 1) % this.rigs.length); e.preventDefault(); }
    if (e.code === 'ArrowRight' || e.code === 'ArrowDown') { this.setHovered((this.hovered + 1) % this.rigs.length); e.preventDefault(); }
    if (e.code === 'Enter' || e.code === 'Space') { this.choose(this.hovered); e.preventDefault(); }
    const n = Number(e.code.replace('Digit', ''));
    if (n >= 1 && n <= this.rigs.length) this.choose(n - 1);
  };

  private setHovered(i: number) {
    this.hovered = i;
    this.root.querySelectorAll('.sel-card').forEach((c, k) => c.classList.toggle('on', k === i));
  }

  private choose(i: number) {
    if (this.done) return;
    this.done = true;
    this.root.classList.add('leaving');
    window.removeEventListener('keydown', this.onKey);
    const id = this.rigs[i].config.id;
    setTimeout(() => { this.root.remove(); this.resolve?.(id); }, 420);
  }

  /** Resolves with the chosen aircraft id. */
  pick(): Promise<string> {
    return new Promise((res) => { this.resolve = res; });
  }

  get isDone() { return this.done; }

  /** Draws one frame of both previews. Call from the render loop until `pick` resolves. */
  render(dt: number) {
    this.time += dt;
    const r = this.renderer;
    const stages = this.root.querySelectorAll<HTMLElement>('.sel-stage');
    r.setScissorTest(true);
    const h = r.domElement.clientHeight;
    for (let i = 0; i < this.rigs.length; i++) {
      const rect = stages[i]?.getBoundingClientRect();
      if (!rect || rect.width < 8) continue;
      this.rects[i] = rect;
      const rig = this.rigs[i];
      // The hovered card turns a little faster and sits slightly closer.
      const focus = i === this.hovered ? 1 : 0;
      rig.pivot.rotation.y = this.time * (0.22 + 0.16 * focus) + i * 1.9;
      rig.pivot.rotation.x = Math.sin(this.time * 0.4 + i) * 0.045 - 0.14;
      rig.pivot.visible = true;
      for (const other of this.rigs) other.pivot.visible = other === rig;

      // Frame the model: back off far enough that its bounding sphere fits the viewport.
      const aspect = rect.width / rect.height;
      this.camera.aspect = aspect;
      const vFov = THREE.MathUtils.degToRad(this.camera.fov);
      const fit = Math.max(rig.radius / Math.tan(vFov / 2), rig.radius / (Math.tan(vFov / 2) * aspect));
      const dist = fit * (1.08 - 0.05 * focus);
      this.camera.position.set(dist * 0.42, dist * 0.30, dist * 0.86);
      this.camera.lookAt(0, 0, 0);
      this.camera.updateProjectionMatrix();

      // three.js applies the pixel ratio itself, so these stay in CSS pixels; and WebGL
      // measures y from the bottom, hence the flip.
      const x = rect.left;
      const y = h - rect.bottom;
      r.setViewport(x, y, rect.width, rect.height);
      r.setScissor(x, y, rect.width, rect.height);
      r.setRenderTarget(null);
      r.render(this.scene, this.camera);
    }
    r.setScissorTest(false);
    r.setViewport(0, 0, r.domElement.clientWidth, h);
    for (const rig of this.rigs) rig.pivot.visible = true;
  }

  /** Releases the preview scene; the aircraft objects themselves are handed back. */
  dispose(): THREE.Object3D[] {
    this.renderer.setClearColor(this.prevClear, this.prevAlpha);
    this.renderer.toneMapping = this.prevToneMapping;
    this.renderer.toneMappingExposure = this.prevExposure;
    atmoUniforms.uCsStrength.value = this.prevCloudShadow;
    document.getElementById('hud')?.classList.remove('hidden');
    document.querySelector('.timectl')?.classList.remove('hidden');
    const objects: THREE.Object3D[] = [];
    for (const rig of this.rigs) {
      const child = rig.pivot.children[0];
      if (child) { rig.pivot.remove(child); objects.push(child); }
      this.scene.remove(rig.pivot);
    }
    return objects;
  }
}
