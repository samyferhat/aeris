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
  private duck!: GainNode;
  private menuGain!: GainNode;
  private gunGain!: GainNode;
  private gunLfoGain!: GainNode;
  private seekerGain!: GainNode;
  private seekerOsc!: OscillatorNode;
  private seekerLfo!: OscillatorNode;
  private seekerLfoGain!: GainNode;
  private combatNoise!: AudioBuffer;
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
  // --- turbine voice -------------------------------------------------------
  private whine!: OscillatorNode;
  private whineGain!: GainNode;
  private whineFilter!: BiquadFilterNode;
  private buzz!: OscillatorNode;
  private buzzGain!: GainNode;
  private roarSrcJet!: AudioBufferSourceNode;
  private roarJetFilter!: BiquadFilterNode;
  private roarJetGain!: GainNode;
  private abSrc!: AudioBufferSourceNode;
  private abFilter!: BiquadFilterNode;
  private abGain!: GainNode;
  private profile: 'propeller' | 'turbofan' = 'propeller';
  private wasSupersonic = false;

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
    // Everything passes through a duck gain so a close blast can briefly deafen the
    // pilot, which is what a big explosion actually does and what a game normally fakes
    // with a filter sweep. Here it is one node in the right place.
    this.duck = ctx.createGain();
    this.duck.gain.value = 1;
    // A second gain for the menus. Kept separate from the blast duck so a help panel
    // opened during an explosion does not fight it for the same parameter.
    this.menuGain = ctx.createGain();
    this.menuGain.gain.value = 1;
    this.duck.connect(this.menuGain);
    this.menuGain.connect(this.master);
    this.cabinFilter.connect(this.duck);

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

    this.buildTurbine(ctx, noise, toBus);
    this.buildCombat(ctx, noise, toBus);
    this.master.gain.setTargetAtTime(0.85, ctx.currentTime, 1.2);
  }

  /**
   * A turbofan sounds nothing like a piston engine, and the difference is structural
   * rather than a matter of pitch:
   *   * the fan's blade-passing tone — dozens of blades times shaft speed, so a whine
   *     one to three kilohertz up, with the "buzz saw" of the supersonic blade tips
   *     underneath it;
   *   * the core roar — broadband, low, and much louder than anything a light aircraft
   *     makes;
   *   * reheat — a separate, deeper roar with far more low-frequency energy, which is
   *     what you feel in the chest rather than hear.
   */
  private buildTurbine(ctx: AudioContext, noise: AudioBuffer, toBus: (n: AudioNode) => void) {
    this.whineFilter = ctx.createBiquadFilter();
    this.whineFilter.type = 'bandpass';
    this.whineFilter.frequency.value = 2000;
    this.whineFilter.Q.value = 2.4;
    this.whineGain = ctx.createGain(); this.whineGain.gain.value = 0;
    this.whineFilter.connect(this.whineGain);
    toBus(this.whineGain);
    this.whine = ctx.createOscillator();
    // A rich, slightly metallic wave: the fan tone plus its first few harmonics.
    const real = new Float32Array([0, 1.0, 0.42, 0.30, 0.16, 0.10, 0.06]);
    this.whine.setPeriodicWave(ctx.createPeriodicWave(real, new Float32Array(real.length)));
    this.whine.frequency.value = 400;
    this.whine.connect(this.whineFilter);
    this.whine.start();

    // Buzz saw: a sub-octave sawtooth that appears as the fan tips go supersonic.
    this.buzz = ctx.createOscillator();
    this.buzz.type = 'sawtooth';
    this.buzz.frequency.value = 120;
    const buzzFilter = ctx.createBiquadFilter();
    buzzFilter.type = 'bandpass'; buzzFilter.frequency.value = 700; buzzFilter.Q.value = 1.1;
    this.buzzGain = ctx.createGain(); this.buzzGain.gain.value = 0;
    this.buzz.connect(buzzFilter); buzzFilter.connect(this.buzzGain);
    toBus(this.buzzGain);
    this.buzz.start();

    this.roarSrcJet = ctx.createBufferSource();
    this.roarSrcJet.buffer = noise; this.roarSrcJet.loop = true;
    this.roarJetFilter = ctx.createBiquadFilter();
    this.roarJetFilter.type = 'bandpass'; this.roarJetFilter.frequency.value = 260; this.roarJetFilter.Q.value = 0.55;
    this.roarJetGain = ctx.createGain(); this.roarJetGain.gain.value = 0;
    this.roarSrcJet.connect(this.roarJetFilter); this.roarJetFilter.connect(this.roarJetGain);
    toBus(this.roarJetGain);
    this.roarSrcJet.start();

    this.abSrc = ctx.createBufferSource();
    this.abSrc.buffer = noise; this.abSrc.loop = true;
    this.abFilter = ctx.createBiquadFilter();
    this.abFilter.type = 'lowpass'; this.abFilter.frequency.value = 150; this.abFilter.Q.value = 1.6;
    this.abGain = ctx.createGain(); this.abGain.gain.value = 0;
    this.abSrc.connect(this.abFilter); this.abFilter.connect(this.abGain);
    toBus(this.abGain);
    this.abSrc.start();
  }

  setProfile(profile: 'propeller' | 'turbofan') { this.profile = profile; }

  /**
   * Weapon and warning voices.
   *
   * The gun is the interesting one. Twenty-five rounds a second is far too fast for
   * one-shot samples: it is a continuous tearing sound, so it is built as one, from a
   * resonant band of noise gated at the firing rate with a sub underneath. Turning the
   * trigger on and off is then a gain ramp, which also gets the spin-up and the
   * trailing thud of the last round for free.
   */
  private buildCombat(ctx: AudioContext, noise: AudioBuffer, toBus: (n: AudioNode) => void) {
    this.combatNoise = noise;
    // --- gun -------------------------------------------------------------
    const src = ctx.createBufferSource();
    src.buffer = noise; src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 210; bp.Q.value = 1.4;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1800;
    this.gunGain = ctx.createGain();
    this.gunGain.gain.value = 0;
    // The gate: a square at the cyclic rate, which is what gives a cannon its rip.
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 25;
    this.gunLfoGain = ctx.createGain();
    this.gunLfoGain.gain.value = 0.55;
    const bias = ctx.createConstantSource();
    bias.offset.value = 0.45;
    const gate = ctx.createGain();
    gate.gain.value = 0;
    lfo.connect(this.gunLfoGain); this.gunLfoGain.connect(gate.gain);
    bias.connect(gate.gain);
    src.connect(bp); bp.connect(lp); lp.connect(gate); gate.connect(this.gunGain);
    // A sub sine under it, so the burst is felt as well as heard.
    const sub = ctx.createOscillator();
    sub.type = 'sine'; sub.frequency.value = 62;
    const subG = ctx.createGain(); subG.gain.value = 0.30;
    sub.connect(subG); subG.connect(gate);
    toBus(this.gunGain);
    src.start(); lfo.start(); bias.start(); sub.start();

    // --- infrared seeker growl -------------------------------------------
    // A square through a lowpass, chopped by a second oscillator whose rate climbs
    // with the lock. Every pilot who has heard one knows what a good tone sounds like
    // in half a second, which is exactly the point of putting it in.
    this.seekerOsc = ctx.createOscillator();
    this.seekerOsc.type = 'square';
    this.seekerOsc.frequency.value = 300;
    const sf = ctx.createBiquadFilter();
    sf.type = 'lowpass'; sf.frequency.value = 1400;
    this.seekerLfo = ctx.createOscillator();
    this.seekerLfo.type = 'square';
    this.seekerLfo.frequency.value = 8;
    this.seekerLfoGain = ctx.createGain();
    this.seekerLfoGain.gain.value = 0.5;
    const sBias = ctx.createConstantSource();
    sBias.offset.value = 0.5;
    const sGate = ctx.createGain();
    sGate.gain.value = 0;
    this.seekerLfo.connect(this.seekerLfoGain); this.seekerLfoGain.connect(sGate.gain);
    sBias.connect(sGate.gain);
    this.seekerGain = ctx.createGain();
    this.seekerGain.gain.value = 0;
    this.seekerOsc.connect(sf); sf.connect(sGate); sGate.connect(this.seekerGain);
    // Straight to the cabin filter: it is in the pilot's headset, not in the world.
    this.seekerGain.connect(this.dry);
    this.seekerOsc.start(); this.seekerLfo.start(); sBias.start();
  }

  /**
   * Pull the world down behind a menu rather than cutting it. The engine going quiet
   * but not silent is what keeps the pause feeling like the aircraft is still there.
   */
  setMenuDuck(on: boolean) {
    if (!this.ctx) return;
    this.menuGain.gain.setTargetAtTime(on ? 0.22 : 1, this.ctx.currentTime, on ? 0.10 : 0.22);
  }

  /** Trigger held or released. */
  setGunFiring(on: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.gunGain.gain.setTargetAtTime(on ? 0.34 : 0, t, on ? 0.008 : 0.05);
  }

  /** Seeker tone, 0..1. Rises in pitch and in chop rate as the head settles. */
  setSeekerTone(level: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const l = Math.min(1, Math.max(0, level));
    this.seekerGain.gain.setTargetAtTime(l > 0.02 ? 0.026 + 0.055 * l : 0, t, 0.08);
    this.seekerOsc.frequency.setTargetAtTime(280 + 640 * l * l, t, 0.10);
    this.seekerLfo.frequency.setTargetAtTime(6 + 26 * l, t, 0.10);
  }

  /**
   * A motor lighting, heard from wherever the pilot is. The Doppler is applied by
   * hand from the closing rate: it is the shift that makes a missile leaving the rail
   * sound like it is going somewhere.
   */
  whoosh(distance: number, closing: number, power = 1) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + Math.min(1.5, distance / 343);
    const src = ctx.createBufferSource();
    src.buffer = this.combatNoise;
    // 343 m/s: the shift is small but it is the difference between a hiss and a launch.
    src.playbackRate.value = Math.max(0.55, Math.min(1.9, 1 + closing / 343));
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(260, t);
    bp.frequency.exponentialRampToValueAtTime(1500, t + 0.35);
    bp.frequency.exponentialRampToValueAtTime(420, t + 1.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.42 * power, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    src.connect(bp); bp.connect(g);
    g.connect(this.dry); g.connect(this.cockpitSend); g.connect(this.outsideSend);
    src.start(t); src.stop(t + 1.6);
  }

  /**
   * An explosion at a distance. Sound travels at three hundred and forty-three metres
   * a second and light does not, so the bang is scheduled late by exactly that much:
   * a fuel tank going up two kilometres away flashes, and then, five seconds later,
   * arrives. That gap is the single most convincing thing in the whole audio mix.
   */
  blast(distance: number, power: number) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const delay = Math.min(9, distance / 343);
    const t = ctx.currentTime + delay;
    // Distance also eats the top end: far explosions are all bottom.
    const near = Math.exp(-distance / 900);
    const amp = Math.min(0.95, (0.22 + 0.5 * power) * (0.14 + 0.86 * near));

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120 * (1 + 0.3 * power), t);
    osc.frequency.exponentialRampToValueAtTime(26, t + 0.55 + 0.25 * power);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(amp, t + 0.015);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.9 + 0.4 * power);
    osc.connect(og);

    const src = ctx.createBufferSource();
    src.buffer = this.combatNoise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(4200 * near + 240, t);
    lp.frequency.exponentialRampToValueAtTime(180, t + 0.7);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(amp * 0.8, t + 0.02);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 1.1 + 0.6 * power);
    src.connect(lp); lp.connect(ng);

    for (const n of [og, ng]) {
      n.connect(this.dry); n.connect(this.cockpitSend); n.connect(this.outsideSend);
    }
    osc.start(t); osc.stop(t + 1.6 + 0.6 * power);
    src.start(t); src.stop(t + 1.8 + 0.6 * power);

    // Close and loud: everything else drops away for a moment and comes back.
    if (distance < 260 && power > 1.2) {
      const d = this.duck.gain;
      d.cancelScheduledValues(t);
      d.setValueAtTime(1, t);
      d.linearRampToValueAtTime(0.24, t + 0.05);
      d.setTargetAtTime(1, t + 0.25, 0.7);
    }
  }

  /**
   * The launch warning. A real Russian voice if the platform has one — the alert in a
   * Soviet cockpit is a woman's voice, and a synthesised one in the right language is
   * closer to the truth than any tone. Falls back to a two-note alert.
   */
  private lastVoice = 0;
  voice(text: string) {
    if (this.muted) return;
    const now = performance.now();
    if (now - this.lastVoice < 3000) return;
    this.lastVoice = now;
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
    if (synth) {
      const ru = synth.getVoices().find((v) => v.lang.startsWith('ru'));
      if (ru) {
        const u = new SpeechSynthesisUtterance(text);
        u.voice = ru; u.lang = ru.lang; u.rate = 1.05; u.pitch = 1.15; u.volume = 0.9;
        try { synth.cancel(); synth.speak(u); return; } catch { /* fall through */ }
      }
    }
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator();
      o.type = 'square'; o.frequency.value = 880;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.10, t + i * 0.18 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.18 + 0.12);
      o.connect(g); g.connect(this.dry);
      o.start(t + i * 0.18); o.stop(t + i * 0.18 + 0.14);
    }
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

  /** 0 = open sea, 1 = a hard surface close on every side. */
  private enclosure = 0;
  setEnclosure(v: number) { this.enclosure = Math.max(0, Math.min(1, v)); }

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

    const jet = this.profile === 'turbofan';
    if (jet) {
      // N1 as a fraction; the config reports it directly as 0..100.
      const n1 = clamp01(s.rpm / 100);
      const running = n1 > 0.05 ? 1 : 0;
      // Fan blade passing: 30-odd blades on the shaft.
      const fan = 45 + n1 * 330;
      this.whine.frequency.setTargetAtTime(fan * 4.4 * doppler, t, k);
      this.whineFilter.frequency.setTargetAtTime(700 + n1 * 2600, t, k);
      this.buzz.frequency.setTargetAtTime(fan * doppler, t, k);
      const atten = inside ? 1 : Math.min(1, 55 / Math.max(24, dist));
      // From inside the cockpit the fan tone is muffled by the airframe; from outside
      // it is the loudest thing about a fighter until the reheat lights.
      this.whineGain.gain.setTargetAtTime(running * (inside ? 0.045 : 0.16) * (0.25 + 0.85 * n1) * atten, t, k);
      this.buzzGain.gain.setTargetAtTime(running * (inside ? 0.02 : 0.085) * smoothstepJS(0.55, 0.95, n1) * atten, t, k);
      this.roarJetFilter.frequency.setTargetAtTime(150 + n1 * 260, t, k);
      this.roarJetGain.gain.setTargetAtTime(running * (inside ? 0.20 : 0.30) * (0.2 + 0.9 * n1) * atten, t, k);
      this.abFilter.frequency.setTargetAtTime(90 + s.afterburner * 130, t, k);
      this.abGain.gain.setTargetAtTime(s.afterburner * (inside ? 0.34 : 0.52) * atten, t, k);
      // Silence the piston voice.
      this.engineGain.gain.setTargetAtTime(0, t, k);
      this.roarGain.gain.setTargetAtTime(0, t, k);
      this.propGain.gain.setTargetAtTime(0, t, k);
      // Crossing the sound barrier, once per crossing and only heard from outside.
      const supersonic = s.mach > 1.0;
      if (supersonic !== this.wasSupersonic && !inside && s.mach > 0.5) this.boom();
      this.wasSupersonic = supersonic;
    } else {
      this.whineGain.gain.setTargetAtTime(0, t, k);
      this.buzzGain.gain.setTargetAtTime(0, t, k);
      this.roarJetGain.gain.setTargetAtTime(0, t, k);
      this.abGain.gain.setTargetAtTime(0, t, k);
    }

    // --- engine --------------------------------------------------------------
    // Four cylinders, four-stroke: two firing events per revolution.
    const fire = (s.rpm / 60) * 2;
    const running = !jet && s.rpm > 200 ? 1 : 0;
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
    // Outside, how much comes back depends on what there is to come back off. Over open
    // water there is nothing; between the walls of the strait, or down a street, there
    // is a great deal, and that difference is most of what tells you where you are.
    this.outsideSend.gain.setTargetAtTime(inside ? 0.0 : 0.055 + 0.42 * this.enclosure, t, 0.45);
    this.dry.gain.setTargetAtTime(inside ? 0.85 : 1.0, t, 0.25);
    this.cabinFilter.frequency.setTargetAtTime(inside ? 2400 : 18000, t, 0.25);
  }

  /**
   * Sonic boom. The N-wave that reaches an observer is a sharp over-pressure, a ramp
   * down through ambient, and a second sharp recovery — heard as a double crack rather
   * than one bang, which is the detail that makes it recognisable.
   */
  boom() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const [delay, level] of [[0, 1.0], [0.09, 0.72]] as [number, number][]) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer(ctx, 0.6);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(1800, t + delay);
      lp.frequency.exponentialRampToValueAtTime(90, t + delay + 0.5);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + delay);
      g.gain.exponentialRampToValueAtTime(0.85 * level, t + delay + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + delay + 0.55);
      src.connect(lp); lp.connect(g); g.connect(this.dry); g.connect(this.outsideSend);
      src.start(t + delay); src.stop(t + delay + 0.6);
    }
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
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smoothstepJS = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
