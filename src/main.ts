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
import { Aircraft } from './aircraft/Aircraft';
import { CameraRig } from './aircraft/Cameras';
import { HUD } from './ui/HUD';
import { TimeSlider } from './ui/TimeSlider';
import { Pipeline } from './fx/Pipeline';

const smoothstepJS = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const loadingFill = document.querySelector('#loading .fill') as HTMLElement;
const loadingMsg = document.querySelector('#loading .msg') as HTMLElement;
const progress = (p: number, msg: string) => { loadingFill.style.width = `${Math.round(p * 100)}%`; loadingMsg.textContent = msg; };

async function boot() {
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
  const runway = new Runway(texLoader);
  scene.add(runway);
  progress(0.5, 'Végétation');
  const vegetation = new Vegetation(hf);
  scene.add(vegetation);
  for (const m of vegetation.materials) engine.setupShadowMaterial(m);
  engine.setupShadowMaterial(terrain.material);
  engine.setupShadowMaterial(ocean.material);
  runway.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material; if (m && !(m as any)._csm) { (m as any)._csm = true; engine.setupShadowMaterial(m); } });

  progress(0.55, 'Avion');
  const fm = new FlightModel(hf);
  let aircraft: Aircraft | null = null;
  try {
    aircraft = await Aircraft.load('/models/cessna.glb', (p) => progress(0.55 + p * 0.3, 'Avion'));
    scene.add(aircraft);
    const wl = aircraft.wheelLocals();
    if (wl.nose && wl.left && wl.right) fm.setWheels([
      { name: 'nose', local: wl.nose, steer: true, brake: false },
      { name: 'left', local: wl.left, steer: false, brake: true },
      { name: 'right', local: wl.right, steer: false, brake: true }]);
    if (aircraft.locators.Camera_Pilot) rig.pilotEye.copy(aircraft.locators.Camera_Pilot);
    for (const m of aircraft.materials) if (!(m as THREE.ShaderMaterial).isShaderMaterial) engine.setupShadowMaterial(m);
  } catch (e) {
    console.warn('Aircraft model not available yet', e);
  }
  fm.resetOnRunway(RUNWAY.x - 480, RUNWAY.z, RUNWAY.y, Math.PI / 2);

  progress(0.9, 'Post-traitement');
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
      case 'reset': fm.resetOnRunway(RUNWAY.x - 480, RUNWAY.z, RUNWAY.y, Math.PI / 2); break;
      case 'pause': paused = !paused; break;
      case 'flapsUp': input.controls.flaps = Math.max(0, input.controls.flaps - 1 / 3); break;
      case 'flapsDown': input.controls.flaps = Math.min(1, input.controls.flaps + 1 / 3); break;
      case 'timeUp': timeSlider.set(timeSlider.value + 0.5); break;
      case 'timeDown': timeSlider.set(timeSlider.value - 0.5); break;
      case 'hud': hud.toggle(); break;
    }
  };
  window.addEventListener('resize', () => { engine.resize(camera); post.setSize(window.innerWidth, window.innerHeight); });

  // Debug/reproducible views: ?pos=x,y,z&hour=h&mode=orbit|chase|cockpit&heading=deg
  const params = new URLSearchParams(location.search);
  if (params.has('pos')) { const [x, y, z] = params.get('pos')!.split(',').map(Number); fm.position.set(x, y, z); fm.velocity.set(0, 0, 0); }
  if (params.has('heading')) {
    // heading 0 = north (-Z); rotating +Z about +Y by (180 - heading) lands there.
    fm.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(180 - Number(params.get('heading'))));
    fm.syncBasis();
  }
  if (params.has('hour')) timeSlider.set(Number(params.get('hour')));
  if (params.has('mode')) rig.mode = params.get('mode') as any;
  if (params.has('freeze')) paused = true;
  if (params.has('debug')) post.debugView = params.get('debug') as any;
  if (params.has('orbit')) { const [t, p, d] = params.get('orbit')!.split(',').map(Number); rig.orbit.theta = t; rig.orbit.phi = p; rig.orbit.dist = d; }
  if (params.has('speed')) { fm.syncBasis(); fm.velocity.copy(fm.forward).multiplyScalar(Number(params.get('speed'))); }
  document.getElementById('overlay')!.classList.add('gone');
  (window as any).__aeris = { fm, rig, atmosphere, applyTime, renderer, scene, THREE, camera, post, terrain, ocean, vegetation };

  let last = performance.now();
  let turbulence = 0;

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
    if (fm.touchdownEvent > 0) { rig.addShake(Math.min(1, fm.touchdownEvent * 0.35)); fm.touchdownEvent = 0; }
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
  // Settle the streaming systems and the camera springs before the first painted frame.
  for (let i = 0; i < 8; i++) tick(1 / 60);

  loop();
}

boot().catch((e) => { console.error(e.stack); loadingMsg.textContent = 'Erreur : ' + e.message; });
