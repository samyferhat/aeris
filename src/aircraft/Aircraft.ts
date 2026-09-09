import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FlightModel } from './FlightModel';
import { applyAerialPerspective } from '../sky/AerialPerspective';
import { applyLivery, applyCockpitMetal, applyTyre, applyCabinTrim, rootInverse } from './Livery';
import { Instruments } from './Instruments';
import { clamp, lerp } from '../core/Noise';

const deg = THREE.MathUtils.degToRad;
const _tmpN = new THREE.Vector3();

/** Materials that live inside the cabin and need extra ambient to read at all. */
const INTERIOR_MATERIALS = new Set([
  'Cockpit_Carpet', 'Cockpit_Trim', 'Cockpit_Plastic', 'Gauge_Faces',
  'Cockpit_Metal_Worn', 'Leather_Seat',
]);

/**
 * Visual aircraft: loads the Blender-authored GLB, wires the named parts, and animates
 * control surfaces, propeller (blades + motion-blur disc), gear compression, wheels,
 * yoke and lights from the flight model each frame.
 */
export class Aircraft extends THREE.Group {
  parts: Record<string, THREE.Object3D> = {};
  private propAngle = 0;
  private rest: Record<string, { pos: THREE.Vector3; quat: THREE.Quaternion }> = {};
  propDiscMaterial: THREE.ShaderMaterial | null = null;
  readonly locators: Record<string, THREE.Vector3> = {};
  private lights: { nav: THREE.PointLight[]; beacon: THREE.PointLight | null; strobe: THREE.PointLight | null; sprites: THREE.Sprite[] } = { nav: [], beacon: null, strobe: null, sprites: [] };
  private t = 0;
  gearCompression = [0, 0, 0];
  private wheelSpin = [0, 0, 0];
  materials: THREE.Material[] = [];
  glass: THREE.Mesh | null = null;
  instruments: Instruments | null = null;

  static async load(url: string, onProgress?: (p: number) => void): Promise<Aircraft> {
    const gltf = await new GLTFLoader().loadAsync(url, (e) => onProgress?.(e.total ? e.loaded / e.total : 0.5));
    const ac = new Aircraft();
    ac.setup(gltf.scene);
    return ac;
  }

  private setup(root: THREE.Object3D) {
    this.add(root);
    // Materials are shared between meshes, so patch each one exactly once and remember
    // the replacement (the paint becomes a MeshPhysicalMaterial for its clearcoat).
    const patched = new Map<THREE.Material, THREE.Material>();
    root.traverse((o) => {
      this.parts[o.name] = o;
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true; mesh.receiveShadow = true;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const out: THREE.Material[] = [];
      for (const m of mats) {
        let replacement = patched.get(m);
        if (!replacement) {
          const std = m as THREE.MeshStandardMaterial;
          if (std.map) std.map.anisotropy = 8;
          std.envMapIntensity = INTERIOR_MATERIALS.has(m.name) ? 2.2 : 1.0;
          if (m.name === 'Paint_Body') {
            replacement = applyLivery(std);
          } else if (m.name === 'Glass') {
            this.setupGlass(std, mesh); replacement = std;
          } else if (m.name === 'PropBlur') {
            this.setupPropDisc(mesh); replacement = mesh.material as THREE.Material;
            patched.set(m, replacement); out.push(replacement); continue;
          } else if (m.name === 'Cockpit_Metal_Worn') {
            applyCockpitMetal(std); replacement = std;
          } else if (m.name === 'Rubber_Tire') {
            applyTyre(std); replacement = std;
          } else if (m.name === 'Cockpit_Trim' || m.name === 'Cockpit_Walls') {
            applyCabinTrim(std, 'trim'); replacement = std;
          } else if (m.name === 'Cockpit_Plastic') {
            applyCabinTrim(std, 'plastic'); replacement = std;
          } else if (m.name === 'Cockpit_Carpet') {
            applyCabinTrim(std, 'carpet'); replacement = std;
          } else if (m.name === 'Gauge_Faces') {
            // Swap the still atlas for a canvas that is redrawn from the flight state.
            this.instruments = new Instruments(1024);
            std.map = this.instruments.texture;
            // Instruments are internally lit; without emissive they vanish in the shade.
            std.emissive = new THREE.Color(0xffffff);
            std.emissiveMap = this.instruments.texture;
            std.emissiveIntensity = 0.55;
            std.roughness = 0.30; std.metalness = 0;
            replacement = std;
          } else {
            replacement = std;
          }
          if ((replacement as THREE.ShaderMaterial).isShaderMaterial !== true) applyAerialPerspective(replacement);
          patched.set(m, replacement);
          this.materials.push(replacement);
        }
        out.push(replacement);
      }
      mesh.material = Array.isArray(mesh.material) ? out : out[0];
      // The instrument dials are modelled a centimetre inside their bezels, so the
      // panel's own recess bottoms hide them. Float them just proud of the surface.
      if (out.some((m) => m.name === 'Gauge_Faces')) {
        const n = mesh.geometry.getAttribute('normal');
        const mean = new THREE.Vector3();
        for (let i = 0; i < n.count; i++) mean.add(_tmpN.fromBufferAttribute(n, i));
        mesh.position.addScaledVector(mean.normalize(), 0.025);
      }
    });
    for (const n of ['Aileron_L', 'Aileron_R', 'Elevator', 'Rudder', 'Flap_L', 'Flap_R', 'Gear_Nose', 'Gear_L', 'Gear_R', 'Yoke_L', 'Propeller', 'Wheel_Nose', 'Wheel_L', 'Wheel_R'])
      if (this.parts[n]) this.rest[n] = { pos: this.parts[n].position.clone(), quat: this.parts[n].quaternion.clone() };
    for (const n of ['Camera_Pilot', 'Exhaust', 'Wingtip_L', 'Wingtip_R', 'Contact_Nose', 'Contact_L', 'Contact_R', 'Nav_L', 'Nav_R', 'Beacon', 'Strobe_Tail'])
      if (this.parts[n]) { this.updateMatrixWorld(true); this.locators[n] = this.parts[n].getWorldPosition(new THREE.Vector3()).sub(this.getWorldPosition(new THREE.Vector3())); }
    this.setupLights();
    this.setupCabinLight();
  }

  private setupGlass(m: THREE.MeshStandardMaterial, mesh: THREE.Mesh) {
    this.glass = mesh;
    m.transparent = true; m.opacity = 0.32; m.roughness = 0.06; m.metalness = 0; m.depthWrite = false;
    m.color.set(0xbfd6e6); m.envMapIntensity = 1.6; m.side = THREE.DoubleSide;
    mesh.castShadow = false; mesh.renderOrder = 10;
    // Micro-scratches / smudges: procedural roughness variation in the shader.
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = (s, r) => {
      prev?.call(m, s, r);
      // MeshStandardMaterial has no generic `vUv`, so carry our own copy of the uv.
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vGlassUv;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvGlassUv = uv;');
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vGlassUv;')
        .replace('#include <roughnessmap_fragment>', `
        float roughnessFactor = roughness;
        {
          // Micro-scratches (fine anisotropic streaks) plus a slow polishing smudge.
          vec2 g = vGlassUv * 140.0;
          float scratch = smoothstep(0.985, 1.0, sin(g.x * 1.7 + sin(g.y * 0.3) * 4.0) * sin(g.y * 0.9 + 3.0));
          float smudge = 0.5 + 0.5 * sin(vGlassUv.x * 23.0 + sin(vGlassUv.y * 17.0) * 3.0);
          roughnessFactor = roughness + scratch * 0.35 + smudge * 0.05;
        }`);
    };
  }

  private setupPropDisc(mesh: THREE.Mesh) {
    // Radial motion-blur disc: alpha grows with RPM, subtle rotating blade streaks.
    const mat = new THREE.ShaderMaterial({
      uniforms: { uRpm: { value: 0 }, uAngle: { value: 0 }, uColor: { value: new THREE.Color(0x16181a) } },
      vertexShader: `varying vec2 vLocal; void main(){ vLocal = position.xy; if (abs(normal.z) < 0.5) vLocal = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uRpm; uniform float uAngle; uniform vec3 uColor; varying vec2 vLocal;
        void main(){ float r = length(vLocal); float a = atan(vLocal.y, vLocal.x) - uAngle;
          float vis = smoothstep(500.0, 1400.0, uRpm);
          float radial = smoothstep(0.08, 0.2, r) * (1.0 - smoothstep(0.85, 1.0, r / 0.98));
          float streak = 0.55 + 0.45 * pow(abs(sin(a * 1.0)), 6.0);  // faint 2-blade ghost
          float alpha = vis * radial * (0.20 + 0.26 * streak) * (0.55 + 0.45 * smoothstep(0.3, 0.9, r));
          gl_FragColor = vec4(uColor, alpha); }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    mesh.material = mat; mesh.castShadow = false; mesh.renderOrder = 5;
    this.propDiscMaterial = mat;
  }

  /**
   * Soft fill inside the cabin. Without global illumination a closed cockpit renders
   * almost black, because the only light that should reach it — sky bouncing off the
   * panel and the seats — is exactly what a direct + IBL model cannot deliver through
   * a small opening. A short-range point light stands in for that bounce; its range
   * keeps it from leaking onto the airframe outside.
   */
  private setupCabinLight() {
    const light = new THREE.PointLight(0xbcd0e6, 0, 3.2, 2.0);
    light.position.set(0, 0.55, -0.15);
    light.castShadow = false;
    this.add(light);
    this.cabinLight = light;
  }
  cabinLight: THREE.PointLight | null = null;

  /**
   * Position lights. These exist to be seen, not to illuminate: on a real aircraft the
   * beacon barely tints the wing root. Keeping the point lights weak and short-range is
   * what stops the night view turning into a red flood.
   */
  private setupLights() {
    const mk = (name: string, color: number, intensity: number, size: number) => {
      const p = this.parts[name]; if (!p) return null;
      const light = new THREE.PointLight(color, 0, 7, 2); light.intensity = intensity; p.add(light);
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: Aircraft.glowTexture(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      spr.scale.setScalar(size); p.add(spr); this.lights.sprites.push(spr);
      (spr as any)._base = intensity;
      return light;
    };
    const l = mk('Nav_L', 0xff2a1a, 0.5, 0.30), r = mk('Nav_R', 0x25ff5a, 0.5, 0.30);
    if (l) this.lights.nav.push(l); if (r) this.lights.nav.push(r);
    this.lights.beacon = mk('Beacon', 0xff2020, 1.6, 0.42);
    this.lights.strobe = mk('Strobe_Tail', 0xffffff, 4.0, 0.55);
  }

  static glowTexture(): THREE.Texture {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d')!, grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.25, 'rgba(255,255,255,0.5)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }

  /** Contact points (body frame) for the physics, if the model provides them. */
  wheelLocals(): { nose?: THREE.Vector3; left?: THREE.Vector3; right?: THREE.Vector3 } {
    return { nose: this.locators.Contact_Nose, left: this.locators.Contact_L, right: this.locators.Contact_R };
  }

  update(dt: number, fm: FlightModel, night: number) {
    this.t += dt;
    this.instruments?.update(fm.state, dt, performance.now());
    this.position.copy(fm.position);
    this.quaternion.copy(fm.quaternion);
    // The livery is evaluated in aircraft space, so the shaders need world -> root.
    this.updateMatrixWorld(true);
    rootInverse.value.copy(this.matrixWorld).invert();
    const set = (name: string, axis: THREE.Vector3, angle: number) => {
      const p = this.parts[name], r = this.rest[name]; if (!p || !r) return;
      p.quaternion.copy(r.quat).multiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
    };
    const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
    // Control surfaces. Model frame is +Z nose, +Y up, +X LEFT wing, and every hinge is
    // aft of its pivot, so a positive rotation about local +X lifts a trailing edge.
    //   roll right  -> left aileron trailing edge DOWN, right aileron UP
    //   pull (nose up) -> elevator trailing edge UP
    //   right rudder -> trailing edge swings toward -X (the aircraft's right)
    set('Aileron_L', X, -deg(20) * fm.aileron);
    set('Aileron_R', X, deg(20) * fm.aileron);
    set('Elevator', X, deg(22) * fm.elevator);
    set('Rudder', Y, deg(24) * fm.rudder);
    set('Flap_L', X, -deg(30) * fm.flaps);
    set('Flap_R', X, -deg(30) * fm.flaps);
    // Propeller
    const radPerSec = fm.rpm / 60 * Math.PI * 2;
    this.propAngle = (this.propAngle + radPerSec * dt) % (Math.PI * 2);
    set('Propeller', Z, -this.propAngle);   // right-hand tractor: clockwise seen from the cockpit
    if (this.propDiscMaterial) { this.propDiscMaterial.uniforms.uRpm.value = fm.rpm; this.propDiscMaterial.uniforms.uAngle.value = this.propAngle * 0.13; }
    // Blades fade as the disc takes over (keeps a believable blur, not a solid disc)
    const prop = this.parts['Propeller'] as THREE.Mesh | undefined;
    if (prop) prop.visible = fm.rpm < 1500;
    // Gear compression + wheels
    const names = ['Gear_Nose', 'Gear_L', 'Gear_R'], wheels = ['Wheel_Nose', 'Wheel_L', 'Wheel_R'];
    for (let i = 0; i < 3; i++) {
      const comp = fm.state.wheelCompression[i] ?? 0;
      this.gearCompression[i] = lerp(this.gearCompression[i], comp, 1 - Math.exp(-dt * 14));
      const g = this.parts[names[i]], r = this.rest[names[i]];
      if (g && r) g.position.copy(r.pos).add(new THREE.Vector3(0, this.gearCompression[i] * 0.9, 0));
      const w = this.parts[wheels[i]], wr = this.rest[wheels[i]];
      if (w && wr) {
        if (fm.state.wheelOnGround[i]) this.wheelSpin[i] += fm.state.groundSpeed / 0.24 * dt;
        else this.wheelSpin[i] += Math.max(0, fm.state.groundSpeed - 5) * 0.2 * dt * Math.exp(-this.t % 3);
        w.quaternion.copy(wr.quat).multiply(new THREE.Quaternion().setFromAxisAngle(X, this.wheelSpin[i]));
        if (i === 0) w.parent && (w.parent.rotation.y = -fm.rudder * 0.45 * (fm.state.onGround ? 1 : 0));
      }
    }
    // Yoke: rotate for roll, slide for pitch
    const yoke = this.parts['Yoke_L'], yr = this.rest['Yoke_L'];
    if (yoke && yr) {
      yoke.quaternion.copy(yr.quat).multiply(new THREE.Quaternion().setFromAxisAngle(Z, -fm.aileron * deg(45)));
      // (rotation about +Z turns the wheel the same way the pilot's hands do)
      yoke.position.copy(yr.pos).add(new THREE.Vector3(0, 0, -fm.elevator * 0.06));
    }
    // Cabin fill tracks the sky so the interior darkens at dusk like everything else.
    if (this.cabinLight) this.cabinLight.intensity = 2.6 * (1 - night * 0.85) + 0.25;
    // Lights: nav always on at dusk/night, beacon rotating, strobe double-flash
    const nightOn = night > 0.05 ? 1 : 0.15;
    const beacon = 0.5 + 0.5 * Math.sin(this.t * 6.0) > 0.7 ? 1 : 0.05;
    const strobePhase = (this.t % 1.6);
    const strobe = (strobePhase < 0.05 || (strobePhase > 0.12 && strobePhase < 0.17)) ? 1 : 0;
    this.lights.nav.forEach((l) => (l.intensity = 0.5 * nightOn));
    if (this.lights.beacon) this.lights.beacon.intensity = 1.6 * beacon * (0.3 + 0.7 * night);
    if (this.lights.strobe) this.lights.strobe.intensity = 4.0 * strobe;
    for (const s of this.lights.sprites) {
      const p = s.parent!.name;
      const f = p === 'Beacon' ? beacon : p === 'Strobe_Tail' ? strobe : 1;
      s.material.opacity = clamp(f * (0.30 + 0.70 * night), 0.05, 1);
      s.scale.setScalar((p === 'Strobe_Tail' ? 0.9 : p === 'Beacon' ? 0.55 : 0.34) * (0.45 + 0.55 * night) * (0.6 + 0.4 * f));
    }
  }
}
