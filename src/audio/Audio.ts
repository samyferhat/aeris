import * as THREE from 'three';
import { FlightState } from '../aircraft/FlightModel';
import { CameraMode } from '../aircraft/Cameras';

const SPEED_OF_SOUND = 343;

/**
 * Fully synthesised soundscape — no samples, so nothing to load and everything stays
 * continuously tied to the simulation.
 *
 *  * Engine: a four-cylinder four-stroke fires twice per revolution, so the fundamental
 *    is rpm/30 Hz (80 Hz at 2400 rpm). It is built from a custom periodic wave with a
 *    harmonic series measured to sound like a Lycoming, layered with a second wave an
 *    octave up and a band-passed noise "roar" for the exhaust.
 *  * Propeller: a separate, harder-edged tone at the blade-passing frequency.
 *  * Wind: pink-ish noise through a band-pass whose centre frequency and gain follow
 *    airspeed, plus a second, sharper band for the slipstream past the canopy.
 *  * Doppler: the Web Audio doppler API was removed years ago, so the shift is applied
 *    by hand from the radial velocity between the camera and the aircraft.
 *  * Space: two convolution reverbs, a tight muffled one for the cockpit and an open
 *    one for the outside views, cross-faded when the camera changes.
 */
export class Audio {
  private ctx: AudioContext | null = null;
  private started = false;
  private master!: GainNode;
  private dry!: GainNode;
  private cockpitSend!: GainNode;
  private outsideSend!: GainNode;
  private engineGain!: GainNode;
  private engineOsc!: OscillatorNode;
  private engineOsc2!: OscillatorNode;
  private engineFilter!: BiquadFilterNode;
  private propOsc!: OscillatorNode;
  private propGain!: GainNode;
  private roarSrc!: AudioBufferSourceNode;
  private roarFilter!: BiquadFilterNode;
  private roarGain!: GainNode;
  private windSrc!: AudioBufferSourceNode;
  private windFilter!: BiquadFilterNode;
  private windGain!: GainNode;
  private gustFilter!: BiquadFilterNode;
  private gustGain!: GainNode;
  private rumbleSrc!: AudioBufferSourceNode;
  private rumbleGain!: GainNode;
  private rumbleFilter!: BiquadFilterNode;
  private cabinFilter!: BiquadFilterNode;
  private prevCamPos = new THREE.Vector3();
  private haveCamPos = false;
  muted = false;

  /** Web Audio needs a user gesture; wire that up once. */
  attach(target: HTMLElement) {
    const start = () => { this.start(); };
    target.addEventListener('pointerdown', start, { once: true });
    window.addEventListener('keydown', start, { once: true });
  }

  private start() {
    if (this.started) return;
    this.started = true;
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.0;
    this.master.connect(ctx.destination);

    // Cabin colouration: inside, everything is heard through the firewall and the glass.
    this.cabinFilter = ctx.createBiquadFilter();
    this.cabinFilter.type = 'lowpass';
    this.cabinFilter.frequency.value = 20000;
    this.cabinFilter.Q.value = 0.7;
    this.cabinFilter.connect(this.master);

    this.dry = ctx.createGain();
    this.dry.gain.value = 1;
    this.dry.connect(this.cabinFilter);

    const mkVerb = (seconds: number, decay: number, damp: number, wet: number) => {
      const conv = ctx.createConvolver();
      conv.buffer = this.impulse(ctx, seconds, decay, damp);
      const send = ctx.createGain();
      send.gain.value = wet;
      send.connect(conv);
      conv.connect(this.cabinFilter);
      return send;
    };
    // Tight, absorbent little cabin; wide, bright outside.
    this.cockpitSend = mkVerb(0.16, 5.5, 2600, 0.0);
    this.outsideSend = mkVerb(0.9, 2.4, 6500, 0.0);

    const toBus = (node: AudioNode) => { node.connect(this.dry); node.connect(this.cockpitSend); node.connect(this.outsideSend); };

    // ---- engine ------------------------------------------------------------
    // A Lycoming's timbre is dominated by the 1st, 2nd and 4th harmonics with a
    // strong, slightly rough exhaust note; these coefficients were tuned by ear.
    const real = new Float32Array([0, 1.0, 0.62, 0.20, 0.44, 0.14, 0.22, 0.09, 0.13, 0.06, 0.09, 0.04]);
    const imag = new Float32Array(real.length);
    const wave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });

    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 1800;
    this.engineFilter.Q.value = 0.9;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter.connect(this.engineGain);
    toBus(this.engineGain);

    this.engineOsc = ctx.createOscillator();
    this.engineOsc.setPeriodicWave(wave);
    this.engineOsc.frequency.value = 25;
    this.engineOsc.connect(this.engineFilter);
    this.engineOsc.start();

    this.engineOsc2 = ctx.createOscillator();
    this.engineOsc2.type = 'triangle';
    this.engineOsc2.frequency.value = 50;
    const g2 = ctx.createGain(); g2.gain.value = 0.28;
    this.engineOsc2.connect(g2); g2.connect(this.engineFilter);
    this.engineOsc2.start();

    // Exhaust roar: noise pushed through a band-pass that tracks the firing rate.
    const noise = this.noiseBuffer(ctx, 4);
    this.roarSrc = ctx.createBufferSource();
    this.roarSrc.buffer = noise; this.roarSrc.loop = true;
    this.roarFilter = ctx.createBiquadFilter();
    this.roarFilter.type = 'bandpass'; this.roarFilter.frequency.value = 320; this.roarFilter.Q.value = 1.4;
    this.roarGain = ctx.createGain(); this.roarGain.gain.value = 0;
    this.roarSrc.connect(this.roarFilter); this.roarFilter.connect(this.roarGain);
    toBus(this.roarGain);
    this.roarSrc.start();

    // ---- propeller ---------------------------------------------------------
    this.propOsc = ctx.createOscillator();
    this.propOsc.type = 'sawtooth';
    this.propOsc.frequency.value = 40;
    const propFilter = ctx.createBiquadFilter();
    propFilter.type = 'bandpass'; propFilter.frequency.value = 900; propFilter.Q.value = 0.8;
    this.propGain = ctx.createGain(); this.propGain.gain.value = 0;
    this.propOsc.connect(propFilter); propFilter.connect(this.propGain);
    toBus(this.propGain);
    this.propOsc.start();

    // ---- airflow -----------------------------------------------------------
    this.windSrc = ctx.createBufferSource();
    this.windSrc.buffer = noise; this.windSrc.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass'; this.windFilter.frequency.value = 500; this.windFilter.Q.value = 0.5;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    this.windSrc.connect(this.windFilter); this.windFilter.connect(this.windGain);
    toBus(this.windGain);
    this.windSrc.start();

    // Sharper whistle past the canopy seals, only audible at speed.
    this.gustFilter = ctx.createBiquadFilter();
    this.gustFilter.type = 'bandpass'; this.gustFilter.frequency.value = 2600; this.gustFilter.Q.value = 3.5;
    this.gustGain = ctx.createGain(); this.gustGain.gain.value = 0;
    this.windSrc.connect(this.gustFilter); this.gustFilter.connect(this.gustGain);
    toBus(this.gustGain);

    // ---- ground rumble -----------------------------------------------------
    this.rumbleSrc = ctx.createBufferSource();
    this.rumbleSrc.buffer = noise; this.rumbleSrc.loop = true;
    this.rumbleFilter = ctx.createBiquadFilter();
    this.rumbleFilter.type = 'lowpass'; this.rumbleFilter.frequency.value = 180; this.rumbleFilter.Q.value = 1.2;
    this.rumbleGain = ctx.createGain(); this.rumbleGain.gain.value = 0;
    this.rumbleSrc.connect(this.rumbleFilter); this.rumbleFilter.connect(this.rumbleGain);
    toBus(this.rumbleGain);
    this.rumbleSrc.start();

    this.master.gain.setTargetAtTime(0.85, ctx.currentTime, 1.2);
  }

  private noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    // Pink-ish noise (Voss-McCartney style running sum) — white noise alone sounds
    // like a hiss, not like air.
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.0990460;
      b1 = 0.96300 * b1 + w * 0.2965164;
      b2 = 0.57000 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22;
    }
    // Cross-fade the loop point so it does not tick.
    const fade = Math.floor(ctx.sampleRate * 0.05);
    for (let i = 0; i < fade; i++) {
      const t = i / fade;
      d[i] = d[i] * t + d[n - fade + i] * (1 - t);
    }
    return buf;
  }

  /** Exponentially decaying noise burst — a serviceable reverb impulse. */
  private impulse(ctx: AudioContext, seconds: number, decay: number, dampHz: number): AudioBuffer {
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lp = 0;
      const a = Math.exp(-2 * Math.PI * dampHz / ctx.sampleRate);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const w = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
        lp = w * (1 - a) + lp * a;
        d[i] = lp;
      }
    }
    return buf;
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.85, this.ctx.currentTime, 0.08);
  }

  /**
   * @param listenerPos camera position, used for distance attenuation and Doppler
   * @param sourcePos   aircraft position
   * @param sourceVel   aircraft velocity
   */
  update(dt: number, s: FlightState, mode: CameraMode, listenerPos: THREE.Vector3, sourcePos: THREE.Vector3, sourceVel: THREE.Vector3, turbulence: number) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const k = 0.05;                       // smoothing time constant for every parameter
    const inside = mode === 'cockpit';

    // --- Doppler -------------------------------------------------------------
    let doppler = 1;
    const dist = listenerPos.distanceTo(sourcePos);
    if (!inside && dist > 0.5) {
      const toListener = _v.copy(listenerPos).sub(sourcePos).divideScalar(dist);
      let listenerVel = 0;
      if (this.haveCamPos) listenerVel = _v2.copy(listenerPos).sub(this.prevCamPos).divideScalar(Math.max(dt, 1e-3)).dot(toListener);
      const sourceRadial = sourceVel.dot(toListener);
      doppler = (SPEED_OF_SOUND - listenerVel) / Math.max(60, SPEED_OF_SOUND - sourceRadial);
      doppler = Math.min(1.25, Math.max(0.8, doppler));
    }
    this.prevCamPos.copy(listenerPos);
    this.haveCamPos = true;

    // --- engine --------------------------------------------------------------
    // Four cylinders, four-stroke: two firing events per revolution.
    const fire = (s.rpm / 60) * 2;
    const running = s.rpm > 200 ? 1 : 0;
    this.engineOsc.frequency.setTargetAtTime(Math.max(10, fire * doppler), t, k);
    this.engineOsc2.frequency.setTargetAtTime(Math.max(20, fire * 2 * doppler), t, k);
    // Distance attenuation: inverse with a floor, plus air absorption of the highs.
    const atten = inside ? 1 : Math.min(1, 22 / Math.max(12, dist));
    const load = 0.35 + 0.65 * s.throttle;
    this.engineGain.gain.setTargetAtTime(running * (inside ? 0.30 : 0.20) * load * atten, t, k);
    this.engineFilter.frequency.setTargetAtTime(
      (inside ? 900 : 2600) * (0.55 + 0.75 * s.throttle) * Math.min(1, 60 / Math.max(20, dist)) + 200, t, k);

    this.roarFilter.frequency.setTargetAtTime(Math.max(90, fire * 3.4 * doppler), t, k);
    this.roarGain.gain.setTargetAtTime(running * (inside ? 0.20 : 0.13) * load * atten, t, k);

    // Blade passing: two blades.
    this.propOsc.frequency.setTargetAtTime(Math.max(10, (s.rpm / 60) * 2 * doppler), t, k);
    this.propGain.gain.setTargetAtTime(running * (inside ? 0.055 : 0.085) * (0.4 + 0.6 * s.throttle) * atten, t, k);

    // --- airflow -------------------------------------------------------------
    const v = s.airspeed;
    const q = Math.min(1, (v / 62) ** 2);                   // dynamic pressure, normalised
    this.windGain.gain.setTargetAtTime((inside ? 0.13 : 0.30) * q, t, k);
    this.windFilter.frequency.setTargetAtTime(240 + v * 10, t, k);
    this.gustGain.gain.setTargetAtTime((inside ? 0.075 : 0.03) * q * (0.7 + 0.6 * turbulence), t, k);
    this.gustFilter.frequency.setTargetAtTime(1800 + v * 22, t, k);

    // --- ground --------------------------------------------------------------
    const rolling = s.onGround ? Math.min(1, s.groundSpeed / 26) : 0;
    this.rumbleGain.gain.setTargetAtTime(rolling * (inside ? 0.34 : 0.20), t, k);
    this.rumbleFilter.frequency.setTargetAtTime(90 + s.groundSpeed * 6, t, k);

    // --- space ---------------------------------------------------------------
    this.cockpitSend.gain.setTargetAtTime(inside ? 0.30 : 0.0, t, 0.25);
    this.outsideSend.gain.setTargetAtTime(inside ? 0.0 : 0.16, t, 0.25);
    this.dry.gain.setTargetAtTime(inside ? 0.85 : 1.0, t, 0.25);
    this.cabinFilter.frequency.setTargetAtTime(inside ? 2400 : 18000, t, 0.25);
  }

  /** One-shot: tyres chirping on touchdown. */
  chirp(strength: number) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx, 0.4);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 1.1;
    bp.frequency.exponentialRampToValueAtTime(520, t + 0.35);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.min(0.55, 0.12 + strength * 0.4), t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.40);
    src.connect(bp); bp.connect(g); g.connect(this.dry); g.connect(this.outsideSend);
    src.start(t); src.stop(t + 0.45);
  }

  /** One-shot: airframe thump when the gear takes the load. */
  thump(strength: number) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(90, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.22);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.min(0.7, 0.15 + strength * 0.5), t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.30);
    osc.connect(g); g.connect(this.dry); g.connect(this.cockpitSend); g.connect(this.outsideSend);
    osc.start(t); osc.stop(t + 0.32);
  }
}

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
