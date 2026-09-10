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
import { CombatHud } from './ui/CombatHud';
import { HelpPanel } from './ui/HelpPanel';
import { TimeSlider } from './ui/TimeSlider';
import { Pipeline } from './fx/Pipeline';
import { Particles } from './fx/Particles';
import { Audio } from './audio/Audio';
import { Afterburner } from './fx/Afterburner';
import { JetEffects } from './fx/JetEffects';
import { Selection } from './ui/Selection';
import { LoadoutScreen } from './ui/LoadoutScreen';
import { Loadout } from './combat/Armament';
import { StoreRack } from './combat/StoreRack';
import { CombatFx } from './combat/Effects';
import { Ordnance } from './combat/Ordnance';
import { STORES } from './combat/Armament';
import { TargetWorld } from './combat/Targets';
import { EnemyFleet, FlareDispenser } from './combat/Enemy';
import { Targeting } from './combat/Targeting';

const _size = new THREE.Vector2();
const _zero = new THREE.Vector3();
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

  progress(0.84, 'Armement');
  await StoreRack.preload().catch((e) => console.warn('stores unavailable', e));
  await TargetWorld.preload().catch((e) => console.warn('targets unavailable', e));
  await EnemyFleet.preload().catch((e) => console.warn('enemies unavailable', e));

  let aircraft: Aircraft | null = null;
  let afterburner: Afterburner | null = null;
  let jetEffects: JetEffects | null = null;

  // Only the fighter is armed. The loadout owns the armament state; the rack owns the
  // meshes, and the flight model is told the mass and drag they cost.
  const loadout = new Loadout('mixed');
  const rack = new StoreRack();
  const syncStores = () => {
    rack.rebuild(loadout);
    fm.storeMass = loadout.mass;
    fm.storeDrag = loadout.drag;
  };
  loadout.onChange = syncStores;

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
    for (const m of StoreRack.allMaterials()) engine.setupShadowMaterial(m);

    if (cfg.armed) {
      rack.bind(aircraft, aircraft.locators);
      // Through onChange, not syncStores, so the selected weapon is picked as well.
      loadout.onChange?.();
    } else {
      rack.clear();
      fm.storeMass = 0; fm.storeDrag = 0;
    }

    if (cfg.propulsion === 'turbofan') {
      const exits = ['Nozzle_Exit_L', 'Nozzle_Exit_R']
        .map((n) => aircraft!.locators[n])
        .filter(Boolean) as THREE.Vector3[];
      if (exits.length) {
        afterburner = new Afterburner(exits, 0.52, 6.2);
        aircraft.add(afterburner);
      }
      jetEffects = new JetEffects(cfg.span, 17);
      aircraft.add(jetEffects);
    }
    fm.resetOnRunway(RUNWAY.x - 420, RUNWAY.z, RUNWAY.y, Math.PI / 2);
  };

  const particles = new Particles();
  scene.add(particles);
  const combatFx = new CombatFx();
  scene.add(combatFx);
  const ordnance = new Ordnance(combatFx, hf, rack);
  scene.add(ordnance);
  const targets = new TargetWorld(hf, combatFx);
  scene.add(targets);
  targets.build((_site, prop, at) => {
    const d = at.distanceTo(fm.position);
    audio.blast(d, prop.kind === 'fuel' ? 3.2 : prop.kind === 'structure' ? 2.2 : 1.6);
  });
  // The forest has to make room for what has been built on it.
  vegetation.clearings.push(...targets.clearings);
  const enemies = new EnemyFleet(hf, combatFx);
  scene.add(enemies);
  // A few jets sitting on the enemy apron, and a patrol in the air over the middle.
  const field = targets.airfieldCentre;
  if (field) {
    for (let i = 0; i < 4; i++) {
      const node = EnemyFleet.parked();
      if (!node) break;
      const px = field.x - 46 + i * 26, pz = field.z - 26;
      targets.addParked(node, new THREE.Vector3(px, hf.getHeight(px, pz), pz), Math.PI * 0.5 + 0.1 * i);
      targets.add(node);
    }
  }
  /** The player, as something a missile can chase and hurt. */
  const player = {
    position: fm.position, velocity: fm.velocity, radius: 8.0, alive: true, name: 'Vous',
    hp: 320,
    get heat() { return 0.8 + 1.4 * fm.state.afterburner; },
    damage(amount: number, at: THREE.Vector3) {
      this.hp -= amount;
      combatFx.impact(at, _zero.set(0, 1, 0), 1.2, 'metal');
      rig.addShake(Math.min(1.0, amount * 0.012));
      audio.thump(Math.min(1, amount * 0.008));
      if (this.hp <= 0) { fm.destroy(); combatFx.explosion(fm.position, 2.2, 'air'); }
    },
  };
  for (let i = 0; i < 3; i++) {
    const e = enemies.spawn(new THREE.Vector3(600 + i * 700, 1500 + i * 260, 1400 - i * 500),
      Math.PI * 0.5 + i * 0.6, 240 + i * 12);
    if (!e) continue;
    e.onLaunch = (from) => {
      // The shot uses the same R-73 the player carries, so the warning, the smoke and
      // the manoeuvre needed to defeat it are all things already learnt from firing one.
      ordnance.launchFree('R73', from, e.quaternion, e.velocity, player, atmosphere.night, e);
      combatHud.launchWarning(from);
      audio.voice('Пуск');
    };
  }
  /** Everything the ordnance can hit, rebuilt when the roster changes. */
  const refreshTargets = () => {
    const list = targets.all.slice();
    enemies.collectTargets(list as never[]);
    if (fm.config.armed) list.push(player as never);
    flares.collect(list as never[]);
    ordnance.targets = list;
    ordnance.playerTarget = fm.config.armed ? (player as never) : null;
  };
  const flares = new FlareDispenser();
  refreshTargets();
  const targeting = new Targeting(ordnance);

  // ---- weapons audio -------------------------------------------------------
  // Everything is heard from where the pilot is, with the travel time of sound put
  // back in: the flash of a fuel tank two kilometres away arrives six seconds before
  // the bang, and nothing else in the mix sells distance half as well.
  ordnance.onImpact = (pos, power, kind) => {
    const d = pos.distanceTo(fm.position);
    audio.blast(d, kind === 'fuel' ? power * 1.4 : power);
    if (d < 220) rig.addShake(Math.min(0.8, power * 0.45 * (1 - d / 220)));
  };
  ordnance.onFire = (what, pos) => {
    if (what === 'missile' || what === 'rocket') {
      const closing = fm.velocity.length();
      audio.whoosh(pos.distanceTo(fm.position), closing, what === 'missile' ? 1 : 0.55);
    }
  };
  for (const m of TargetWorld.allMaterials()) engine.setupShadowMaterial(m);
  for (const m of targets.apronMaterials) engine.setupShadowMaterial(m);
  for (const m of EnemyFleet.allMaterials()) engine.setupShadowMaterial(m);
  /** The weapon the trigger and the release button are pointed at. */
  let selectedWeapon: string | null = null;
  const pickWeapon = (dir: number) => {
    const av = loadout.available;
    if (!av.length) { selectedWeapon = null; return; }
    const i = selectedWeapon ? av.indexOf(selectedWeapon) : -1;
    selectedWeapon = av[((i + dir) % av.length + av.length) % av.length];
  };
  loadout.onChange = () => {
    syncStores();
    if (!selectedWeapon || !loadout.available.includes(selectedWeapon)) pickWeapon(1);
  };
  const audio = new Audio();
  audio.attach(canvas);

  progress(0.92, 'Post-traitement');
  const post = new Pipeline(renderer, scene, camera);
  const hud = new HUD();
  const combatHud = new CombatHud(document.getElementById('hud')!);
  const help = new HelpPanel();
  // Opening the panel stops the world and pulls the engine down behind it.
  help.onToggle = (open) => { helpPaused = open; audio.setMenuDuck(open); };
  let helpPaused = false;
  const timeSlider = new TimeSlider(atmosphere.hour);
  const applyTime = (h: number) => {
    atmosphere.setHour(h);
    engine.setSun(atmosphere.sunDir, atmosphere.sunColor, atmosphere.sunIntensity);
    environment.invalidate();
    runway.setNight(atmosphere.night);
    post.sunColor.copy(atmosphere.sunColor).multiplyScalar(smoothstepJS(-0.05, 0.1, atmosphere.sunElevation));
    // Aim the metering lower once the sun is down, so night reads as night.
    post.exposureKey = 0.15 + 0.29 * smoothstepJS(-0.14, 0.10, atmosphere.sunElevation);
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
      case 'hud': hud.toggle(); combatHud.toggle(); break;
      case 'mute': audio.toggleMute(); break;
      case 'gear': if (fm.config.retractableGear) fm.gearTarget = fm.gearTarget > 0.5 ? 0 : 1; break;
      case 'weaponNext': pickWeapon(1); break;
      case 'weaponPrev': pickWeapon(-1); break;
      case 'launch':
        if (fm.config.armed && selectedWeapon) {
          if (ordnance.launch(loadout, selectedWeapon, fm, targeting.handoff(), atmosphere.night)) rig.addShake(0.25);
        }
        break;
      case 'lock': if (fm.config.armed) targeting.cycle(fm, loadout, selectedWeapon); break;
      case 'flare':
        if (fm.config.armed) {
          const loc = aircraft?.locators['Flare_' + (flares.left % 2 ? 'L' : 'R')];
          _zero.copy(loc ?? new THREE.Vector3()).applyQuaternion(fm.quaternion).add(fm.position);
          flares.fire(_zero, fm.velocity, combatFx, atmosphere.night);
        }
        break;
      case 'trimReset': fm.trim = 0; break;
      case 'shot': wantShot = true; break;
      case 'fullscreen':
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen().catch(() => { /* denied */ });
        break;
      case 'help': help.toggle(); break;
    }
  };
  window.addEventListener('resize', () => { engine.resize(camera); post.setSize(window.innerWidth, window.innerHeight); });

  /**
   * A still, straight off the canvas. It has to be taken in the same turn as the draw:
   * without preserveDrawingBuffer the back buffer is gone by the next event loop.
   */
  const saveScreenshot = (r: THREE.WebGLRenderer) => {
    try {
      const url = r.domElement.toDataURL('image/png');
      const a = document.createElement('a');
      const t = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      a.href = url; a.download = `aeris-${t}.png`;
      a.click();
    } catch (e) { console.warn('screenshot failed', e); }
  };

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



  (window as any).__aeris = { fm, rig, atmosphere, applyTime, renderer, scene, THREE, camera, post, terrain, ocean, vegetation, particles, audio, equip, loaded, byId, engine, input, loadout, rack, ordnance, combatFx, targets, enemies, targeting, combatHud, STORES, get weapon() { return selectedWeapon; } };

  let last = performance.now();
  let turbulence = 0;
  let tunnel = 0;

  /** One simulation + render step. Split out of the rAF loop so tools can drive it. */
  /** Set by the screenshot key; served after the frame is on the canvas. */
  let wantShot = false;

  const tick = (dt: number) => {
    input.update(dt);
    // Trim, free look and zoom are read straight off the input rather than routed
    // through the flight model, because none of them are aerodynamic.
    fm.trim = THREE.MathUtils.clamp(fm.trim + input.consumeTrim(), -0.6, 0.6);
    rig.lookYaw = input.controls.lookYaw;
    rig.lookPitch = input.controls.lookPitch;
    rig.zoom = input.controls.zoom ? 1 : 0;
    const frozen = paused || helpPaused;
    if (!frozen) {
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
    // --- weapons -----------------------------------------------------------
    if (aircraft && fm.config.armed && !frozen) {
      const muzzle = aircraft.locators.Gun_Muzzle ?? _zero;
      const eject = aircraft.locators.Gun_Eject ?? _zero;
      ordnance.fireGun(dt, fm, muzzle, eject, loadout, input.controls.fire, atmosphere.night);
      audio.setGunFiring(ordnance.gunFiredThisFrame);
      if (ordnance.gunFiredThisFrame) {
        // The recoil is real: it slows the aircraft and shakes the airframe, which is
        // most of why a burst feels like firing something rather than pressing a key.
        const dv = ordnance.recoil.z / (fm.config.mass + fm.storeMass);
        fm.velocity.addScaledVector(fm.forward, dv);
        rig.addShake(0.09);
      }
    }
    if (!frozen) {
      // A fighter breaks when a missile is on its way; nothing else scares it.
      enemies.update(dt, fm.position, (e) => ordnance.chasedBy(e), atmosphere.night);
      refreshTargets();
      ordnance.update(dt, fm, atmosphere.night);
      targets.update(dt, atmosphere.night);
      flares.update(dt, combatFx, atmosphere.night);
      if (fm.config.armed) targeting.update(dt, fm, loadout, selectedWeapon);
      else targeting.clear();
      audio.setSeekerTone(fm.config.armed && rig.mode === 'cockpit' ? targeting.tone : targeting.tone * 0.55);
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
      combatFx.update(dt, camera, atmosphere.sunDir, atmosphere.sunColor, post.ambientTop, pixelScale,
        (x, z) => Math.max(0, hf.getHeight(x, z)));
    }
    audio.update(dt, fm.state, rig.mode, camera.position, fm.position, fm.velocity, turbulence);
    help.update(dt, input);
    hud.update(fm.state, rig.mode, dt, fm.isCrashed);
    combatHud.draw(dt, camera, targeting, loadout, selectedWeapon, fm.position, fm.config.armed);
    post.render(dt, rig.mode);
    if (wantShot) { wantShot = false; saveScreenshot(renderer); }
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
      // Exposed so the screenshot tooling can drive a frame: the selection runs on its
      // own rAF loop, which a hidden tab never services.
      (window as any).__aeris.selection = selection;
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
  // ---- pre-flight armament -------------------------------------------------
  // Only the fighter gets one, and only when the player has not asked for a specific
  // aircraft on the URL — the debug entry points should land in the air, not in a menu.
  const cfg = byId(chosen);
  const acObject = loaded.get(cfg.id);
  if (cfg.armed && acObject && !params.has('aircraft') && !params.has('nolo')) {
    const lo = new LoadoutScreen(renderer, scene.environment, acObject, acObject.locators, rack, loadout);
    let loLast = performance.now();
    const loLoop = () => {
      if (lo.isDone) return;
      requestAnimationFrame(loLoop);
      const now = performance.now();
      const ldt = Math.min(0.05, (now - loLast) / 1000);
      loLast = now;
      renderer.setRenderTarget(null);
      renderer.clear();
      lo.render(ldt);
    };
    (window as any).__aeris.loadoutScreen = lo;
    loLoop();
    await lo.wait();
    lo.dispose();
  }
  equip(cfg);
  applyDebugParams();

  // Settle the streaming systems and the camera springs before the first painted frame.
  for (let i = 0; i < 8; i++) tick(1 / 60);

  // First run gets the panel; every run after gets the reminder for fifteen seconds.
  if (!help.maybeShowFirstRun()) help.startHint();

  loop();
}

boot().catch((e) => { console.error(e.stack); loadingMsg.textContent = 'Erreur : ' + e.message; });
