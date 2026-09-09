import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { Engine } from './core/Engine';
import { Input } from './core/Input';
import { Heightfield, RUNWAY } from './world/Heightfield';
import { Terrain } from './world/Terrain';
import { Runway } from './world/Runway';
import { Vegetation } from './world/Vegetation';
import { Ocean } from './water/Ocean';
import { Atmosphere } from './sky/Atmosphere';
import { DynamicEnvironment } from './sky/Environment';
import { FlightModel } from './aircraft/FlightModel';
import { CESSNA, MIG29, AIRCRAFT, byId, AircraftConfig } from './aircraft/AircraftConfig';
import { Aircraft } from './aircraft/Aircraft';
import { CameraRig } from './aircraft/Cameras';
import { HUD } from './ui/HUD';
import { TimeSlider } from './ui/TimeSlider';
import { Pipeline } from './fx/Pipeline';
import { Particles } from './fx/Particles';
import { Audio } from './audio/Audio';
import { Afterburner } from './fx/Afterburner';
import { JetEffects } from './fx/JetEffects';
import { Selection } from './ui/Selection';

const _size = new THREE.Vector2();
const smoothstepJS = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const loadingFill = document.querySelector('#loading .fill') as HTMLElement;
const loadingMsg = document.querySelector('#loading .msg') as HTMLElement;
const progress = (p: number, msg: string) => { loadingFill.style.width = `${Math.round(p * 100)}%`; loadingMsg.textContent = msg; };

async function boot() {
  const params = new URLSearchParams(location.search);
  progress(0.05, 'Génération de l’archipel');
  await new Promise((r) => setTimeout(r, 30));
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const engine = new Engine(canvas);
  const { scene, renderer } = engine;
  const input = new Input(canvas);
  const rig = new CameraRig(window.innerWidth / window.innerHeight);
  const camera = rig.camera;
  engine.setupShadows(camera);

  const hf = new Heightfield();
  await hf.generate((p, label) => progress(0.05 + p * 0.18, label));
  progress(0.25, 'Chargement du ciel');
  const stars = await new RGBELoader().loadAsync('/hdri/kloppenheim_02.hdr');
  stars.mapping = THREE.EquirectangularReflectionMapping;
  const atmosphere = new Atmosphere(stars);
  scene.add(atmosphere.sky);
  const environment = new DynamicEnvironment(renderer);

  progress(0.4, 'Terrain et océan');
  const texLoader = new THREE.TextureLoader();
  const terrain = new Terrain(hf, texLoader);
  scene.add(terrain);
  const ocean = new Ocean(hf);
  scene.add(ocean);
  const runway = new Runway(texLoader, renderer.capabilities.maxTextureSize);
  scene.add(runway);
  progress(0.5, 'Végétation');
  const vegetation = new Vegetation(hf);
  scene.add(vegetation);
  for (const m of vegetation.materials) engine.setupShadowMaterial(m);
  engine.setupShadowMaterial(terrain.material);
  engine.setupShadowMaterial(ocean.material);
  runway.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material; if (m && !(m as any)._csm) { (m as any)._csm = true; engine.setupShadowMaterial(m); } });

  // ---- aircraft ----------------------------------------------------------
  progress(0.55, 'Appareils');
  const fm = new FlightModel(hf, CESSNA);
  const loaded = new Map<string, Aircraft>();
  for (let i = 0; i < AIRCRAFT.length; i++) {
    const cfg = AIRCRAFT[i];
    try {
      const ac = await Aircraft.load(cfg, (p) => progress(0.55 + (i + p) / AIRCRAFT.length * 0.28, `Appareil · ${cfg.name}`));
      loaded.set(cfg.id, ac);
    } catch (e) {
      console.warn(`${cfg.name}: model unavailable`, e);
    }
  }

  let aircraft: Aircraft | null = null;
  let afterburner: Afterburner | null = null;
  let jetEffects: JetEffects | null = null;

  /** Puts one of the loaded aircraft into the world and points everything at it. */
  const equip = (cfg: AircraftConfig) => {
    if (aircraft) {
      scene.remove(aircraft);
      if (afterburner) { aircraft.remove(afterburner); afterburner = null; }
      if (jetEffects) { aircraft.remove(jetEffects); jetEffects = null; }
    }
    aircraft = loaded.get(cfg.id) ?? null;
    fm.setConfig(cfg);
    rig.setConfig(cfg);
    audio.setProfile(cfg.propulsion);
    hud.setConfig(cfg);
    post.heatHaze = cfg.propulsion === 'turbofan';
    if (!aircraft) return;
    scene.add(aircraft);
    const wl = aircraft.wheelLocals();
    if (wl.nose && wl.left && wl.right) {
      fm.setWheels([
        { name: 'nose', local: wl.nose, steer: true, brake: false },
        { name: 'left', local: wl.left, steer: false, brake: true },
        { name: 'right', local: wl.right, steer: false, brake: true }]);
    }
    if (aircraft.locators.Camera_Pilot) rig.pilotEye.copy(aircraft.locators.Camera_Pilot);
    for (const m of aircraft.materials) if (!(m as THREE.ShaderMaterial).isShaderMaterial) engine.setupShadowMaterial(m);

    if (cfg.propulsion === 'turbofan') {
      const exits = ['Nozzle_Exit_L', 'Nozzle_Exit_R']
        .map((n) => aircraft!.locators[n])
        .filter(Boolean) as THREE.Vector3[];
      if (exits.length) {
        afterburner = new Afterburner(exits, 0.58, 11);
        aircraft.add(afterburner);
      }
      jetEffects = new JetEffects(cfg.span, 17);
      aircraft.add(jetEffects);
    }
    fm.resetOnRunway(RUNWAY.x - 420, RUNWAY.z, RUNWAY.y, Math.PI / 2);
  };

  const particles = new Particles();
  scene.add(particles);
  const audio = new Audio();
  audio.attach(canvas);

  progress(0.92, 'Post-traitement');
  const post = new Pipeline(renderer, scene, camera);
  const hud = new HUD();
  const timeSlider = new TimeSlider(atmosphere.hour);
  const applyTime = (h: number) => {
    atmosphere.setHour(h);
    engine.setSun(atmosphere.sunDir, atmosphere.sunColor, atmosphere.sunIntensity);
    environment.invalidate();
    runway.setNight(atmosphere.night);
    post.sunColor.copy(atmosphere.sunColor).multiplyScalar(smoothstepJS(-0.05, 0.1, atmosphere.sunElevation));
  };
  timeSlider.onChange = applyTime;
  applyTime(atmosphere.hour);

  let paused = false;
  input.onAction = (a) => {
    switch (a) {
      case 'camera': rig.next(); break;
      case 'reset': fm.resetOnRunway(RUNWAY.x - 420, RUNWAY.z, RUNWAY.y, Math.PI / 2); break;
      case 'pause': paused = !paused; break;
      case 'flapsUp': input.controls.flaps = Math.max(0, input.controls.flaps - 1 / 3); break;
      case 'flapsDown': input.controls.flaps = Math.min(1, input.controls.flaps + 1 / 3); break;
      case 'timeUp': timeSlider.set(timeSlider.value + 0.5); break;
      case 'timeDown': timeSlider.set(timeSlider.value - 0.5); break;
      case 'hud': hud.toggle(); break;
      case 'mute': audio.toggleMute(); break;
      case 'gear': if (fm.config.retractableGear) fm.gearTarget = fm.gearTarget > 0.5 ? 0 : 1; break;
    }
  };
  window.addEventListener('resize', () => { engine.resize(camera); post.setSize(window.innerWidth, window.innerHeight); });

  /**
   * Reproducible views for development and for grabbing reference stills:
   * ?pos=x,y,z &heading=deg &speed=m/s &hour=h &mode=chase|cockpit|orbit &freeze &aircraft=id
   * Applied after the aircraft is equipped, since equipping puts it back on the runway.
   */
  /**
   * Reproducible views for development and for grabbing reference stills:
   *   ?pos=x,y,z &heading=deg &speed=m/s &hour=h &mode=chase|cockpit|orbit
   *   &orbit=theta,phi,dist &freeze &debug=clouds|ao|god|depth &aircraft=cessna|mig29
   * Applied after the aircraft is equipped, because equipping puts it back on the runway.
   */
  const applyDebugParams = () => {
    if (params.has('pos')) {
      const [x, y, z] = params.get('pos')!.split(',').map(Number);
      fm.position.set(x, y, z);
      fm.velocity.set(0, 0, 0);
    }
    if (params.has('heading')) {
      // heading 0 = north (-Z); rotating +Z about +Y by (180 - heading) lands there.
      fm.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(180 - Number(params.get('heading'))));
      fm.syncBasis();
    }
    if (params.has('hour')) timeSlider.set(Number(params.get('hour')));
    if (params.has('mode')) rig.mode = params.get('mode') as any;
    if (params.has('freeze')) paused = true;
    if (params.has('debug')) post.debugView = params.get('debug') as any;
    if (params.has('orbit')) {
      const [t, ph, d] = params.get('orbit')!.split(',').map(Number);
      rig.orbit.theta = t; rig.orbit.phi = ph; rig.orbit.dist = d;
    }
    if (params.has('gear')) { fm.gear = fm.gearTarget = Number(params.get('gear')); }
    if (params.has('speed')) { fm.syncBasis(); fm.velocity.copy(fm.forward).multiplyScalar(Number(params.get('speed'))); }
  };



  (window as any).__aeris = { fm, rig, atmosphere, applyTime, renderer, scene, THREE, camera, post, terrain, ocean, vegetation, particles, audio, equip, loaded, byId };

  let last = performance.now();
  let turbulence = 0;
  let tunnel = 0;

  /** One simulation + render step. Split out of the rAF loop so tools can drive it. */
  const tick = (dt: number) => {
    input.update(dt);
    if (!paused) {
      fm.step(dt, input.controls);
      // Gentle turbulence: stronger in the afternoon thermals and close to the ground.
      const thermals = 0.5 + 0.5 * Math.sin((atmosphere.hour - 14) / 24 * Math.PI * 2);
      const target = (0.15 + 0.35 * thermals) * (fm.state.onGround ? 0 : 1) * Math.max(0, 1 - fm.state.heightAGL / 900);
      turbulence = THREE.MathUtils.lerp(turbulence, target, dt);
      if (!fm.state.onGround) {
        fm.omega.x += (Math.random() - 0.5) * 0.02 * turbulence;
        fm.omega.z += (Math.random() - 0.5) * 0.03 * turbulence;
      }
    }
    if (fm.touchdownEvent > 0) {
      const strength = Math.min(1, fm.touchdownEvent * 0.35);
      rig.addShake(strength);
      audio.thump(strength);
      if (aircraft) {
        if (fm.touchdownEvent > 1.2) audio.chirp(strength);
        particles.touchdownSmoke(strength, aircraft.locators, fm.position, fm.quaternion, fm.velocity);
      }
      fm.touchdownEvent = 0;
    }
    aircraft?.update(dt, fm, atmosphere.night);
    rig.update(dt, fm, input.consumeOrbit(), turbulence);
    atmosphere.update(camera);
    environment.update(scene, atmosphere.sky);
    post.ambientTop.copy(environment.skyTop);
    post.ambientBottom.copy(environment.skyHorizon).multiplyScalar(0.6);
    post.dofEnabled = rig.mode === 'cockpit';
    terrain.update(camera);
    vegetation.update(camera, dt, 0.6 + 0.5 * turbulence);
    ocean.update(dt, camera);
    engine.csm.update();
    afterburner?.update(dt, fm.state, atmosphere.night);
    jetEffects?.update(dt, fm.state);
    // Grey-out: the eye loses blood pressure a beat after the g arrives, and recovers
    // more slowly still, so the effect is filtered rather than instantaneous.
    const gStrain = Math.max(0, (Math.abs(fm.state.gLoad) - 4.2) / (fm.config.gLimit - 3.0));
    tunnel += (Math.min(1, gStrain) - tunnel) * (1 - Math.exp(-dt * (gStrain > tunnel ? 0.55 : 1.6)));
    post.tunnelVision = rig.mode === 'cockpit' ? tunnel : tunnel * 0.45;
    if (aircraft) {
      particles.setLight(atmosphere.sunDir, atmosphere.sunColor);
      // Metres-at-one-metre to pixels: the projection scale for point sprites.
      const pixelScale = renderer.getDrawingBufferSize(_size).y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
      particles.update(dt, fm.state, fm.position, fm.quaternion, fm.velocity, aircraft.locators, pixelScale,
        atmosphere.night, fm.config.propulsion);
    }
    audio.update(dt, fm.state, rig.mode, camera.position, fm.position, fm.velocity, turbulence);
    hud.update(fm.state, rig.mode, dt, fm.isCrashed);
    post.render(dt, rig.mode);
  };

  const loop = () => {
    requestAnimationFrame(loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    tick(dt);
  };

  (window as any).__aeris.tick = tick;
  (window as any).__aeris.warm = (n = 90, dt = 1 / 60) => { for (let i = 0; i < n; i++) tick(dt); };

  // ---- pre-flight selection ----------------------------------------------
  progress(1, 'Prêt');
  document.getElementById('overlay')!.classList.add('gone');
  let chosen = params.get('aircraft');
  if (!chosen || !loaded.has(chosen)) {
    const entries = AIRCRAFT.filter((c) => loaded.has(c.id)).map((c) => ({ config: c, object: loaded.get(c.id)! }));
    if (entries.length > 1) {
      const selection = new Selection(renderer, scene.environment, entries);
      let selLast = performance.now();
      const selLoop = () => {
        if (selection.isDone) return;
        requestAnimationFrame(selLoop);
        const now = performance.now();
        const sdt = Math.min(0.05, (now - selLast) / 1000);
        selLast = now;
        renderer.setRenderTarget(null);
        renderer.clear();
        selection.render(sdt);
      };
      selLoop();
      chosen = await selection.pick();
      selection.dispose();
    } else {
      chosen = entries[0]?.config.id ?? 'cessna';
    }
  }
  equip(byId(chosen));
  applyDebugParams();

  // Settle the streaming systems and the camera springs before the first painted frame.
  for (let i = 0; i < 8; i++) tick(1 / 60);

  loop();
}

boot().catch((e) => { console.error(e.stack); loadingMsg.textContent = 'Erreur : ' + e.message; });
