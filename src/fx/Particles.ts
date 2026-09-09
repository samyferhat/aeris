import * as THREE from 'three';
import { FlightState } from '../aircraft/FlightModel';
import { clamp, smoothstep } from '../core/Noise';

/**
 * The small, cheap effects that sell the flying: wingtip vapour in a hard turn, exhaust
 * haze when the throttle comes up, dust kicked off the ground while taxiing, and tyre
 * smoke at touchdown.
 *
 * One interleaved buffer holds every particle; a single additive point-sprite draw call
 * renders the lot, with size, colour and fade evaluated in the shader from the age.
 */
const MAX = 2200;

type Kind = 0 | 1 | 2;   // 0 vapour, 1 exhaust, 2 dust

export class Particles extends THREE.Points {
  private pos: Float32Array;
  private vel: Float32Array;
  private data: Float32Array;    // x: age, y: life, z: size0, w: kind
  private colorAttr: THREE.BufferAttribute;
  private head = 0;
  private alive = 0;
  private mat: THREE.ShaderMaterial;
  private vapourTimer = 0;
  private exhaustTimer = 0;
  private dustTimer = 0;

  constructor() {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(MAX * 3);
    const data = new Float32Array(MAX * 4);
    const color = new Float32Array(MAX * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aData', new THREE.BufferAttribute(data, 4));
    geo.setAttribute('color', new THREE.BufferAttribute(color, 3));
    geo.setDrawRange(0, 0);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTexture: { value: Particles.softSprite() },
        uPixelScale: { value: 1 },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(1, 1, 1) },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aData;
        varying float vAlpha;
        varying vec3 vCol;
        uniform float uPixelScale;
        void main() {
          float t = clamp(aData.x / aData.y, 0.0, 1.0);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // Puffs expand as they age; vapour expands least, dust the most.
          float grow = mix(1.0, aData.w < 0.5 ? 2.4 : (aData.w < 1.5 ? 3.4 : 3.0), t);
          // aData.z is a diameter in metres; uPixelScale converts metres at one metre of
          // depth into pixels, so the puff keeps a physical size instead of a screen one.
          gl_PointSize = clamp(aData.z * grow * uPixelScale / max(-mv.z, 1.0), 1.0, 420.0);
          // Fade in quickly, out slowly; vapour also thins as it stretches.
          vAlpha = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.35, 1.0, t));
          vCol = color;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uTexture;
        varying float vAlpha;
        varying vec3 vCol;
        void main() {
          vec4 tex = texture2D(uTexture, gl_PointCoord);
          float a = tex.a * vAlpha;
          if (a < 0.004) discard;
          gl_FragColor = vec4(vCol, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      vertexColors: true,
    });

    super(geo, mat);
    this.pos = pos; this.data = data; this.mat = mat;
    this.vel = new Float32Array(MAX * 3);
    this.colorAttr = geo.getAttribute('color') as THREE.BufferAttribute;
    this.frustumCulled = false;
    this.renderOrder = 20;
  }

  static softSprite(): THREE.CanvasTexture {
    const n = 128;
    const c = document.createElement('canvas'); c.width = c.height = n;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    grd.addColorStop(0.0, 'rgba(255,255,255,0.95)');
    grd.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    grd.addColorStop(0.75, 'rgba(255,255,255,0.10)');
    grd.addColorStop(1.0, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, n, n);
    // A little internal structure so puffs are not perfect discs.
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, r = (0.2 + Math.random() * 0.42) * n / 2;
      const x = n / 2 + Math.cos(a) * r, y = n / 2 + Math.sin(a) * r;
      const rr = (0.06 + Math.random() * 0.14) * n;
      const gg = g.createRadialGradient(x, y, 0, x, y, rr);
      gg.addColorStop(0, `rgba(0,0,0,${0.10 + Math.random() * 0.22})`);
      gg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gg; g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  private spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, kind: Kind, r: number, g: number, b: number) {
    const i = this.head;
    this.head = (this.head + 1) % MAX;
    this.alive = Math.min(MAX, this.alive + 1);
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.data[i * 4] = 0; this.data[i * 4 + 1] = life; this.data[i * 4 + 2] = size; this.data[i * 4 + 3] = kind;
    this.colorAttr.setXYZ(i, r, g, b);
  }

  setLight(sunDir: THREE.Vector3, sunColor: THREE.Color) {
    this.mat.uniforms.uSunDir.value.copy(sunDir);
    this.mat.uniforms.uSunColor.value.copy(sunColor);
  }

  /**
   * @param profile 'propeller' emits exhaust haze and taxi dust; 'turbofan' emits
   *        wingtip vortices under load and contrails in cold air instead.
   */
  update(dt: number, s: FlightState, aircraftPos: THREE.Vector3, aircraftQuat: THREE.Quaternion, velocity: THREE.Vector3,
         locators: Record<string, THREE.Vector3>, pixelScale: number, night: number,
         profile: 'propeller' | 'turbofan' = 'propeller') {
    this.mat.uniforms.uPixelScale.value = pixelScale;
    const jet = profile === 'turbofan';

    // ---- wingtip vapour: only when the wing is working hard in humid, low air -------
    // A fighter reaches the load factor that makes vortices visible far more often, and
    // its tips trail a tight, persistent core rather than a wisp.
    const gPull = jet
      ? clamp((Math.abs(s.gLoad) - 2.6) / 3.0, 0, 1)
      : clamp((Math.abs(s.gLoad) - 1.9) / 1.6, 0, 1);
    const humid = 1 - smoothstep(jet ? 2200 : 400, jet ? 6000 : 1600, s.altitude);
    const vapour = gPull * humid * smoothstep(28, 45, s.airspeed) * (jet ? 1.6 : 1);
    this.vapourTimer += dt * vapour * (jet ? 150 : 90);
    while (this.vapourTimer >= 1) {
      this.vapourTimer -= 1;
      const tips = jet ? ['Wingtip_L', 'Wingtip_R', 'LERX_L', 'LERX_R'] : ['Wingtip_L', 'Wingtip_R'];
      for (const key of tips) {
        const l = locators[key];
        if (!l) continue;
        const p = _v1.copy(l).applyQuaternion(aircraftQuat).add(aircraftPos);
        // Born on the tip, immediately left behind by the aircraft.
        this.spawn(p.x, p.y, p.z,
          -velocity.x * 0.06 + (Math.random() - 0.5) * 1.2,
          -velocity.y * 0.06 + (Math.random() - 0.5) * 0.8,
          -velocity.z * 0.06 + (Math.random() - 0.5) * 1.2,
          0.55 + Math.random() * 0.5, 0.30 + Math.random() * 0.20, 0, 0.95, 0.97, 1.0);
      }
    }

    // ---- contrails: cold, thin air behind the nozzles ------------------------------
    if (jet) {
      // Needs cold air and enough mass flow; below the tropopause on a warm day there
      // is nothing to see, which is why they only appear once you have climbed.
      const cold = smoothstep(3200, 5200, s.altitude);
      const flow = clamp(s.throttle * 1.3 - 0.25, 0, 1);
      const rate = cold * flow * 120;
      this.exhaustTimer += dt * rate;
      const exits = ['Nozzle_Exit_L', 'Nozzle_Exit_R'];
      while (this.exhaustTimer >= 1) {
        this.exhaustTimer -= 1;
        const l = locators[exits[(Math.random() * exits.length) | 0]];
        if (!l) break;
        const p = _v1.copy(l).applyQuaternion(aircraftQuat).add(aircraftPos);
        const back = _v2.set(0, 0, -1).applyQuaternion(aircraftQuat);
        this.spawn(p.x, p.y, p.z,
          back.x * 14 + (Math.random() - 0.5) * 2.0,
          back.y * 14 + (Math.random() - 0.5) * 1.4,
          back.z * 14 + (Math.random() - 0.5) * 2.0,
          // Long-lived and slowly spreading, so the trail persists behind the aircraft.
          7.0 + Math.random() * 5.0, 1.6 + Math.random() * 1.2, 0, 0.96, 0.97, 1.0);
      }
    }

    // ---- exhaust: visible when the throttle is opened, thins out in the cruise ------
    const ex = jet ? null : locators.Exhaust;
    if (ex) {
      const rich = clamp(s.throttle * 1.25 - 0.35, 0, 1) * (0.35 + 0.65 * (1 - smoothstep(10, 45, s.airspeed)));
      this.exhaustTimer += dt * rich * 55;
      while (this.exhaustTimer >= 1) {
        this.exhaustTimer -= 1;
        const p = _v1.copy(ex).applyQuaternion(aircraftQuat).add(aircraftPos);
        const back = _v2.set(0, 0, -1).applyQuaternion(aircraftQuat);
        this.spawn(p.x, p.y, p.z,
          velocity.x * 0.35 + back.x * 6 + (Math.random() - 0.5) * 1.2,
          velocity.y * 0.35 + back.y * 6 + 0.8 + Math.random() * 0.6,
          velocity.z * 0.35 + back.z * 6 + (Math.random() - 0.5) * 1.2,
          0.8 + Math.random() * 0.7, 0.22 + Math.random() * 0.18, 1, 0.30, 0.29, 0.28);
      }
    }

    // ---- ground dust and tyre smoke -----------------------------------------------
    if (s.onGround && s.groundSpeed > 1.2 && !jet) {
      const onGrass = 1;
      const rate = clamp(s.groundSpeed / 14, 0, 1) * 34 * onGrass;
      this.dustTimer += dt * rate;
      const contacts = ['Contact_L', 'Contact_R', 'Contact_Nose'];
      while (this.dustTimer >= 1) {
        this.dustTimer -= 1;
        const key = contacts[(Math.random() * 3) | 0];
        const l = locators[key];
        if (!l) continue;
        const p = _v1.copy(l).applyQuaternion(aircraftQuat).add(aircraftPos);
        this.spawn(p.x, p.y + 0.05, p.z,
          -velocity.x * 0.10 + (Math.random() - 0.5) * 1.6,
          0.5 + Math.random() * 1.1,
          -velocity.z * 0.10 + (Math.random() - 0.5) * 1.6,
          0.9 + Math.random() * 0.8, 0.35 + Math.random() * 0.30, 2, 0.62, 0.57, 0.47);
      }
    }

    // ---- integrate ----------------------------------------------------------------
    const posAttr = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const dataAttr = this.geometry.getAttribute('aData') as THREE.BufferAttribute;
    const drag = Math.exp(-1.9 * dt);
    for (let i = 0; i < MAX; i++) {
      const life = this.data[i * 4 + 1];
      if (life <= 0) continue;
      let age = this.data[i * 4] + dt;
      if (age >= life) { this.data[i * 4 + 1] = 0; this.data[i * 4 + 2] = 0; continue; }
      this.data[i * 4] = age;
      const kind = this.data[i * 4 + 3];
      // Exhaust and dust rise; vapour just dissipates.
      const lift = kind === 1 ? 1.6 : kind === 2 ? 0.7 : 0.0;
      this.vel[i * 3] *= drag;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * drag + lift * dt;
      this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    posAttr.needsUpdate = true;
    dataAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.geometry.setDrawRange(0, MAX);

  }

  /** Burst of rubber smoke at the wheels on a firm touchdown. */
  touchdownSmoke(strength: number, locators: Record<string, THREE.Vector3>, aircraftPos: THREE.Vector3, aircraftQuat: THREE.Quaternion, velocity: THREE.Vector3) {
    const n = Math.floor(6 + strength * 26);
    for (const key of ['Contact_L', 'Contact_R']) {
      const l = locators[key];
      if (!l) continue;
      const p = _v1.copy(l).applyQuaternion(aircraftQuat).add(aircraftPos);
      for (let i = 0; i < n; i++) {
        this.spawn(p.x, p.y + 0.06, p.z,
          -velocity.x * 0.16 + (Math.random() - 0.5) * 3.5,
          0.8 + Math.random() * 2.2,
          -velocity.z * 0.16 + (Math.random() - 0.5) * 3.5,
          1.1 + Math.random() * 0.9, 0.26 + Math.random() * 0.22, 2, 0.42, 0.40, 0.38);
      }
    }
  }
}

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();
