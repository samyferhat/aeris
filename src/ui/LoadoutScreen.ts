import * as THREE from 'three';
import { atmoUniforms } from '../sky/Atmosphere';
import { Loadout, PYLONS, PylonId, STORES, PRESETS, PresetId, fits, stationOf } from '../combat/Armament';
import { StoreRack } from '../combat/StoreRack';

/**
 * Pre-flight armament.
 *
 * The silhouette the pylons sit on is not a drawing: it is the aircraft itself, seen
 * from directly above under the same studio rig as the chooser, with the real stores
 * hanging under the real wings. Fitting a weapon rebuilds the rack, so what the player
 * is looking at is the thing they are about to fly — there is no second representation
 * that can go out of step with the first.
 *
 * The six hotspots are the pylon locators projected into the viewport each frame, so
 * they follow the model rather than being pinned to hand-measured pixels.
 */

const _p = new THREE.Vector3();

export class LoadoutScreen {
  private root: HTMLElement;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private pivot = new THREE.Group();
  private radius = 8;
  private done = false;
  private resolve: (() => void) | null = null;
  private selected: PylonId | null = null;
  private dragging: string | null = null;
  private ghost: HTMLElement | null = null;
  private prevToneMapping: THREE.ToneMapping = THREE.NoToneMapping;
  private prevExposure = 1;
  private prevCloudShadow = 0;
  private hotspots = new Map<PylonId, HTMLElement>();

  constructor(
    private renderer: THREE.WebGLRenderer,
    environment: THREE.Texture | null,
    private aircraft: THREE.Object3D,
    private locators: Record<string, THREE.Vector3>,
    private rack: StoreRack,
    private loadout: Loadout,
  ) {
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 300);
    this.scene.environment = environment;
    this.scene.environmentIntensity = 1.15;
    const key = new THREE.DirectionalLight(0xfff2e0, 4.6);
    key.position.set(-3, 8, 4);
    const fill = new THREE.DirectionalLight(0xbdd4ff, 1.9);
    fill.position.set(5, 3, -4);
    const rim = new THREE.DirectionalLight(0xffffff, 2.6);
    rim.position.set(0, 2, 9);
    this.scene.add(key, fill, rim, this.pivot);

    const box = new THREE.Box3().setFromObject(aircraft);
    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    aircraft.position.sub(centre);
    this.pivot.add(aircraft);
    this.radius = Math.max(size.x, size.z) * 0.5;

    rack.bind(aircraft, locators);
    rack.rebuild(loadout);

    this.root = document.createElement('div');
    this.root.className = 'loadout';
    this.root.innerHTML = this.markup();
    document.body.appendChild(this.root);

    this.prevToneMapping = renderer.toneMapping;
    this.prevExposure = renderer.toneMappingExposure;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    this.prevCloudShadow = atmoUniforms.uCsStrength.value;
    atmoUniforms.uCsStrength.value = 0;
    document.getElementById('hud')?.classList.add('hidden');
    document.querySelector('.timectl')?.classList.add('hidden');

    this.wire();
    this.refresh();
  }

  private markup() {
    const palette = Object.values(STORES).map((s) => `
      <button class="lo-item" data-store="${s.id}">
        <span class="lo-name">${s.name}</span>
        <span class="lo-nato">${s.nato}</span>
        <span class="lo-role">${s.role}</span>
        <span class="lo-mass">${s.mass} kg</span>
      </button>`).join('');
    const presets = (Object.keys(PRESETS) as PresetId[]).map((k) => `
      <button class="lo-preset" data-preset="${k}">
        <b>${PRESETS[k].label}</b><small>${PRESETS[k].hint}</small>
      </button>`).join('');
    const spots = PYLONS.map((p) => `
      <button class="lo-spot" data-pylon="${p}">
        <span class="lo-spot-id">${p}</span>
        <span class="lo-spot-store">—</span>
      </button>`).join('');
    return `
      <div class="lo-head">
        <h1>E M P O R T</h1>
        <p>Glissez une arme sur un pylône. Station 1 en bout d’aile, 3 en emplanture.</p>
      </div>
      <div class="lo-main">
        <div class="lo-stage">${spots}</div>
        <div class="lo-side">
          <div class="lo-presets">${presets}</div>
          <div class="lo-palette">
            <button class="lo-item lo-empty" data-store=""><span class="lo-name">Rien</span><span class="lo-role">Station nue</span></button>
            ${palette}
          </div>
          <div class="lo-summary"><span class="lo-mass-total"></span><span class="lo-gun"></span></div>
          <button class="lo-go">DÉCOLLER</button>
        </div>
      </div>`;
  }

  private wire() {
    const stage = this.root.querySelector('.lo-stage') as HTMLElement;
    for (const p of PYLONS) {
      const el = this.root.querySelector(`.lo-spot[data-pylon="${p}"]`) as HTMLElement;
      this.hotspots.set(p, el);
      el.addEventListener('click', () => { this.selected = this.selected === p ? null : p; this.refresh(); });
      el.addEventListener('pointerenter', () => { if (this.dragging) el.classList.add('over'); });
      el.addEventListener('pointerleave', () => el.classList.remove('over'));
    }
    // Drag from the palette on to a pylon. Pointer events rather than HTML drag and
    // drop: the drop target is a button floating over a WebGL canvas, and the native
    // machinery is unreliable there.
    this.root.querySelectorAll<HTMLElement>('.lo-item').forEach((item) => {
      item.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const id = item.dataset.store || '';
        this.dragging = id;
        this.ghost = document.createElement('div');
        this.ghost.className = 'lo-ghost';
        this.ghost.textContent = id ? STORES[id].name : 'Rien';
        document.body.appendChild(this.ghost);
        this.moveGhost(e);
        item.setPointerCapture(e.pointerId);
      });
      item.addEventListener('pointermove', (e) => { if (this.dragging !== null) this.moveGhost(e); });
      item.addEventListener('pointerup', (e) => {
        if (this.dragging === null) return;
        const id = this.dragging;
        this.dragging = null;
        this.ghost?.remove(); this.ghost = null;
        const under = document.elementFromPoint(e.clientX, e.clientY)?.closest('.lo-spot') as HTMLElement | null;
        const py = (under?.dataset.pylon ?? this.selected) as PylonId | undefined;
        if (py) this.fit(py, id || null);
        this.root.querySelectorAll('.lo-spot').forEach((s) => s.classList.remove('over'));
      });
      // A plain click fits to whichever station is selected, for anyone who would
      // rather not drag.
      item.addEventListener('click', () => {
        if (this.selected) this.fit(this.selected, item.dataset.store || null);
      });
    });
    this.root.querySelectorAll<HTMLElement>('.lo-preset').forEach((b) => {
      b.addEventListener('click', () => { this.loadout.applyPreset(b.dataset.preset as PresetId); this.refresh(); });
    });
    (this.root.querySelector('.lo-go') as HTMLElement).addEventListener('click', () => this.finish());
    window.addEventListener('keydown', this.onKey);
    stage.addEventListener('pointerdown', () => { this.selected = null; this.refresh(); });
  }

  private onKey = (e: KeyboardEvent) => {
    if (this.done) return;
    if (e.code === 'Enter') { this.finish(); e.preventDefault(); }
    if (e.code === 'Digit1') this.loadout.applyPreset('aa');
    if (e.code === 'Digit2') this.loadout.applyPreset('ag');
    if (e.code === 'Digit3') this.loadout.applyPreset('mixed');
    this.refresh();
  };

  private moveGhost(e: PointerEvent) {
    if (!this.ghost) return;
    this.ghost.style.left = e.clientX + 'px';
    this.ghost.style.top = e.clientY + 'px';
    const under = document.elementFromPoint(e.clientX, e.clientY)?.closest('.lo-spot');
    this.root.querySelectorAll('.lo-spot').forEach((s) => s.classList.toggle('over', s === under));
  }

  private fit(py: PylonId, store: string | null) {
    if (store && !fits(store, py)) {
      const el = this.hotspots.get(py);
      el?.classList.add('reject');
      setTimeout(() => el?.classList.remove('reject'), 320);
      return;
    }
    this.loadout.set(py, store);
    this.refresh();
  }

  /** Redraw the labels; the 3D updates itself because the rack was rebuilt. */
  private refresh() {
    this.rack.rebuild(this.loadout);
    for (const p of PYLONS) {
      const el = this.hotspots.get(p)!;
      const st = this.loadout.at(p).store;
      el.querySelector('.lo-spot-store')!.textContent = st ? STORES[st].name : '—';
      el.classList.toggle('on', this.selected === p);
      el.classList.toggle('filled', !!st);
    }
    // Grey out anything the selected station will not take.
    this.root.querySelectorAll<HTMLElement>('.lo-item').forEach((it) => {
      const id = it.dataset.store;
      const ok = !id || !this.selected || fits(id, this.selected);
      it.classList.toggle('nofit', !ok);
      if (id) it.classList.toggle('stations-hint', false);
    });
    const mass = Math.round(this.loadout.mass);
    (this.root.querySelector('.lo-mass-total') as HTMLElement).textContent =
      `Emport ${(mass / 1000).toFixed(2)} t · ${this.loadout.available.length} type${this.loadout.available.length > 1 ? 's' : ''} d’arme`;
    (this.root.querySelector('.lo-gun') as HTMLElement).textContent = 'GSh-30-1 · 150 obus';
  }

  private finish() {
    if (this.done) return;
    this.done = true;
    window.removeEventListener('keydown', this.onKey);
    this.root.classList.add('leaving');
    setTimeout(() => { this.root.remove(); this.resolve?.(); }, 380);
  }

  wait(): Promise<void> { return new Promise((r) => { this.resolve = r; }); }
  get isDone() { return this.done; }

  /** One frame: the aircraft from above, and the hotspots pinned to its pylons. */
  render(dt: number) {
    const r = this.renderer;
    const stage = this.root.querySelector('.lo-stage') as HTMLElement;
    const rect = stage.getBoundingClientRect();
    if (rect.width < 8) return;
    const aspect = rect.width / rect.height;
    this.camera.aspect = aspect;
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const fit = Math.max(this.radius / Math.tan(vFov / 2), this.radius / (Math.tan(vFov / 2) * aspect));
    const dist = fit * 1.12;
    // Almost straight down, tipped a few degrees so the stores are not hidden under
    // the wing they hang from. A true plan view is a diagram; this is an aircraft.
    this.camera.position.set(0, dist * 0.985, -dist * 0.175);
    // Nose up the screen: the model's +Z is the nose, so the camera's up has to be +Z.
    this.camera.up.set(0, 0, 1);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    this.pivot.rotation.set(0, 0, 0);

    const h = r.domElement.clientHeight;
    r.setScissorTest(true);
    const x = rect.left, y = h - rect.bottom;
    r.setViewport(x, y, rect.width, rect.height);
    r.setScissor(x, y, rect.width, rect.height);
    r.setRenderTarget(null);
    r.render(this.scene, this.camera);
    r.setScissorTest(false);
    r.setViewport(0, 0, r.domElement.clientWidth, h);

    // Pin the hotspots to the projected pylons.
    this.aircraft.updateMatrixWorld(true);
    for (const p of PYLONS) {
      const loc = this.locators['Store_' + p];
      const el = this.hotspots.get(p)!;
      if (!loc) { el.style.display = 'none'; continue; }
      _p.copy(loc).applyMatrix4(this.aircraft.matrixWorld).project(this.camera);
      const ax = (_p.x * 0.5 + 0.5) * rect.width;
      const ay = (1 - (_p.y * 0.5 + 0.5)) * rect.height;
      // Fan the labels out: sideways away from the centreline, and along the fuselage
      // by station. At this zoom the hardpoints are thirty pixels apart and the labels
      // three times that wide, so anchoring them on the pylon itself is unreadable.
      const side = p[0] === 'L' ? -1 : 1;
      const tier = stationOf(p) - 2;
      const lx = ax + side * 78;
      const ly = ay + tier * 42;
      el.style.left = lx + 'px';
      el.style.top = ly + 'px';
      // The leader back to the hardpoint, as a rotated rule on the element itself.
      const dx = ax - lx, dy = ay - ly;
      el.style.setProperty('--lead-len', Math.hypot(dx, dy).toFixed(1) + 'px');
      el.style.setProperty('--lead-ang', Math.atan2(dy, dx).toFixed(4) + 'rad');
    }
  }

  dispose(): THREE.Object3D | null {
    this.renderer.toneMapping = this.prevToneMapping;
    this.renderer.toneMappingExposure = this.prevExposure;
    atmoUniforms.uCsStrength.value = this.prevCloudShadow;
    document.getElementById('hud')?.classList.remove('hidden');
    document.querySelector('.timectl')?.classList.remove('hidden');
    const child = this.pivot.children.find((c) => c === this.aircraft) ?? null;
    if (child) this.pivot.remove(child);
    this.scene.remove(this.pivot);
    return child;
  }
}
