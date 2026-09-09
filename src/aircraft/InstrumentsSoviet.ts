import * as THREE from 'three';
import { FlightState } from './FlightModel';

const MS_TO_KMH = 3.6;
const TAU = Math.PI * 2;

/**
 * Soviet instrument panel, redrawn from the flight state.
 *
 * Laid out and labelled as in the reference photographs: metric throughout — speed in
 * km/h, altitude in metres, vertical speed in metres per second — Cyrillic legends, the
 * white-on-black face of a Soviet flight instrument, and an attitude indicator built
 * the way theirs are, with the aircraft symbol banking against a fixed horizon rather
 * than the other way round. That inversion is the single most recognisable thing about
 * a Russian cockpit, so it is modelled rather than glossed over.
 *
 * Same atlas contract as the western panel: a 3x3 grid of dials on the top two rows,
 * a strip of readouts below.
 */
export class InstrumentsSoviet {
  readonly texture: THREE.CanvasTexture;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private size: number;
  private cell: number;
  private lastDraw = -1;
  private d = { kmh: 0, alt: 0, vs: 0, hdg: 0, pitch: 0, bank: 0, mach: 0, g: 1, aoa: 0, rpm: 0 };

  constructor(size = 1024) {
    this.size = size;
    this.cell = size / 3;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = size;
    this.g = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.flipY = false;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.generateMipmaps = true;
    this.draw({
      airspeed: 0, indicatedSpeed: 0, mach: 0, groundSpeed: 0, alpha: 0, beta: 0, gLoad: 1,
      altitude: 0, heightAGL: 0, heading: 0, pitch: 0, bank: 0, verticalSpeed: 0, rpm: 0,
      onGround: true, stall: 0, throttle: 0, flaps: 0, afterburner: 0, gear: 1, overG: 0,
      wheelCompression: [], wheelOnGround: [], wheelSlip: 0,
    }, 1);
  }

  update(s: FlightState, dt: number, now: number) {
    if (now - this.lastDraw < 50) return;
    this.lastDraw = now;
    this.draw(s, 0.35);
  }

  private to(key: keyof InstrumentsSoviet['d'], target: number, k: number) {
    this.d[key] += (target - this.d[key]) * k;
    return this.d[key];
  }

  private draw(s: FlightState, k: number) {
    const g = this.g, S = this.size, C = this.cell;
    g.fillStyle = '#070808';
    g.fillRect(0, 0, S, S);

    const kmh = this.to('kmh', s.indicatedSpeed * MS_TO_KMH, k * 0.7);
    const alt = this.to('alt', s.altitude, k * 0.8);
    const vs = this.to('vs', s.verticalSpeed, k * 0.4);
    const pitch = this.to('pitch', s.pitch, k);
    const bank = this.to('bank', s.bank, k);
    const mach = this.to('mach', s.mach, k * 0.6);
    const gl = this.to('g', s.gLoad, k * 0.6);
    const aoa = this.to('aoa', s.alpha * 57.3, k * 0.5);
    this.to('rpm', s.rpm, k * 0.5);
    let diff = s.heading - this.d.hdg;
    while (diff > Math.PI) diff -= TAU;
    while (diff < -Math.PI) diff += TAU;
    this.d.hdg += diff * k * 0.8;

    this.speed(0.5 * C, 0.5 * C, C * 0.45, kmh);
    this.attitude(1.5 * C, 0.5 * C, C * 0.45, pitch, bank);
    this.altimeter(2.5 * C, 0.5 * C, C * 0.45, alt);
    this.mach(0.5 * C, 1.5 * C, C * 0.45, mach, gl);
    this.heading(1.5 * C, 1.5 * C, C * 0.45, this.d.hdg);
    this.vario(2.5 * C, 1.5 * C, C * 0.45, vs, aoa);
    this.readouts(s);
    this.texture.needsUpdate = true;
  }

  // ---- shared furniture ----------------------------------------------------
  private face(cx: number, cy: number, r: number, label: string, sub?: string) {
    const g = this.g;
    g.save();
    const grd = g.createRadialGradient(cx - r * 0.3, cy - r * 0.4, r * 0.1, cx, cy, r * 1.05);
    grd.addColorStop(0, '#1b1e1c'); grd.addColorStop(0.7, '#0c0e0d'); grd.addColorStop(1, '#050605');
    g.fillStyle = grd;
    g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
    // Soviet bezels are a chunky knurled ring rather than a thin chrome bead.
    g.strokeStyle = '#2c302e'; g.lineWidth = r * 0.085;
    g.beginPath(); g.arc(cx, cy, r * 0.965, 0, TAU); g.stroke();
    g.strokeStyle = '#0a0b0a'; g.lineWidth = r * 0.02;
    g.beginPath(); g.arc(cx, cy, r * 0.915, 0, TAU); g.stroke();
    g.fillStyle = 'rgba(226,232,226,0.80)';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `600 ${r * 0.105}px Inter, Arial, sans-serif`;
    g.fillText(label, cx, cy - r * 0.34);
    if (sub) {
      g.font = `400 ${r * 0.085}px Inter, Arial, sans-serif`;
      g.fillStyle = 'rgba(200,208,200,0.55)';
      g.fillText(sub, cx, cy - r * 0.20);
    }
    g.restore();
  }

  private needle(cx: number, cy: number, r: number, angle: number, len: number, width: number, color = '#eef2ec') {
    const g = this.g;
    g.save();
    g.translate(cx, cy); g.rotate(angle);
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(-width * r, -r * 0.05);
    g.lineTo(0, -r * len);
    g.lineTo(width * r, -r * 0.05);
    g.lineTo(width * r * 0.45, r * 0.20);
    g.lineTo(-width * r * 0.45, r * 0.20);
    g.closePath(); g.fill();
    g.restore();
    g.fillStyle = '#0b0c0b';
    g.beginPath(); g.arc(cx, cy, r * 0.06, 0, TAU); g.fill();
    g.strokeStyle = '#3a3f3c'; g.lineWidth = r * 0.014; g.stroke();
  }

  private ticks(cx: number, cy: number, r: number, from: number, to: number, count: number, major: number, label?: (i: number) => string | null) {
    const g = this.g;
    g.save();
    g.strokeStyle = 'rgba(230,236,230,0.88)'; g.fillStyle = 'rgba(230,236,230,0.92)';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let i = 0; i <= count; i++) {
      const a = from + (to - from) * (i / count);
      const isMajor = i % major === 0;
      const l = isMajor ? r * 0.15 : r * 0.085;
      g.lineWidth = isMajor ? r * 0.032 : r * 0.016;
      g.beginPath();
      g.moveTo(cx + Math.sin(a) * (r * 0.86), cy - Math.cos(a) * (r * 0.86));
      g.lineTo(cx + Math.sin(a) * (r * 0.86 - l), cy - Math.cos(a) * (r * 0.86 - l));
      g.stroke();
      const txt = isMajor && label ? label(i) : null;
      if (txt) {
        g.font = `500 ${r * 0.145}px Inter, Arial, sans-serif`;
        g.fillText(txt, cx + Math.sin(a) * (r * 0.615), cy - Math.cos(a) * (r * 0.615));
      }
    }
    g.restore();
  }

  // ---- instruments ---------------------------------------------------------
  /** СКОРОСТЬ — indicated airspeed, km/h. */
  private speed(cx: number, cy: number, r: number, kmh: number) {
    this.face(cx, cy, r, 'СКОРОСТЬ', 'км/ч');
    const a0 = -2.618, a1 = 2.618, v0 = 0, v1 = 1200;
    const toA = (v: number) => a0 + (a1 - a0) * (Math.min(Math.max(v, v0), v1) - v0) / (v1 - v0);
    this.ticks(cx, cy, r, a0, a1, 12, 2, (i) => String(i * 100));
    const g = this.g;
    // Take-off and approach band, as marked on the real dial.
    g.strokeStyle = 'rgba(255,196,60,0.85)'; g.lineWidth = r * 0.05;
    g.beginPath(); g.arc(cx, cy, r * 0.80, toA(240) - Math.PI / 2, toA(320) - Math.PI / 2); g.stroke();
    this.needle(cx, cy, r, toA(kmh), 0.76, 0.033);
  }

  /**
   * АВИАГОРИЗОНТ. On a Soviet attitude indicator the horizon stays level with the
   * world and the little aeroplane banks; western ones do the opposite. Pilots trained
   * on one have to think on the other, which is exactly why it belongs here.
   */
  private attitude(cx: number, cy: number, r: number, pitch: number, bank: number) {
    const g = this.g;
    this.face(cx, cy, r, '', '');
    g.save();
    g.beginPath(); g.arc(cx, cy, r * 0.90, 0, TAU); g.clip();
    g.translate(cx, cy);
    // The drum moves in pitch only; it does not rotate with bank.
    const pxPerRad = r * 1.45;
    const off = pitch * pxPerRad;
    g.fillStyle = '#2a6ea8'; g.fillRect(-r * 2, -r * 2 + off, r * 4, r * 2);
    g.fillStyle = '#6d4a1e'; g.fillRect(-r * 2, off, r * 4, r * 2);
    g.strokeStyle = '#eef2ec'; g.lineWidth = r * 0.028;
    g.beginPath(); g.moveTo(-r * 2, off); g.lineTo(r * 2, off); g.stroke();
    g.lineWidth = r * 0.018; g.fillStyle = '#eef2ec';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `500 ${r * 0.095}px Inter, Arial`;
    for (let d = -30; d <= 30; d += 10) {
      if (d === 0) continue;
      const y = off - (d * Math.PI / 180) * pxPerRad;
      const w = r * 0.30;
      g.beginPath(); g.moveTo(-w, y); g.lineTo(w, y); g.stroke();
      g.fillText(String(Math.abs(d)), -w - r * 0.12, y);
    }
    g.restore();
    // The banking aircraft symbol.
    g.save();
    g.translate(cx, cy); g.rotate(-bank);
    g.strokeStyle = '#f0c419'; g.lineWidth = r * 0.055; g.lineCap = 'round';
    g.beginPath();
    g.moveTo(-r * 0.44, 0); g.lineTo(-r * 0.13, 0);
    g.moveTo(r * 0.13, 0); g.lineTo(r * 0.44, 0);
    g.stroke();
    g.beginPath(); g.moveTo(0, -r * 0.02); g.lineTo(0, r * 0.14); g.stroke();
    g.fillStyle = '#f0c419';
    g.beginPath(); g.arc(0, 0, r * 0.045, 0, TAU); g.fill();
    g.restore();
    g.strokeStyle = '#2c302e'; g.lineWidth = r * 0.09;
    g.beginPath(); g.arc(cx, cy, r * 0.955, 0, TAU); g.stroke();
    g.fillStyle = 'rgba(226,232,226,0.72)';
    g.textAlign = 'center'; g.font = `600 ${r * 0.10}px Inter, Arial`;
    g.fillText('АВИАГОРИЗОНТ', cx, cy + r * 0.72);
  }

  /** ВЫСОТА — altitude in metres: a fast needle for hundreds, a counter for thousands. */
  private altimeter(cx: number, cy: number, r: number, m: number) {
    const g = this.g;
    this.face(cx, cy, r, 'ВЫСОТА', 'м');
    this.ticks(cx, cy, r, 0, TAU, 10, 1, (i) => (i === 10 ? null : String(i)));
    const hundreds = ((m % 1000) / 1000) * TAU;
    g.save();
    g.fillStyle = '#040504'; g.strokeStyle = '#3a3f3c'; g.lineWidth = r * 0.02;
    const bw = r * 0.52, bh = r * 0.19;
    g.beginPath(); g.rect(cx - bw / 2, cy + r * 0.30, bw, bh); g.fill(); g.stroke();
    g.fillStyle = '#eef2ec'; g.font = `600 ${r * 0.14}px "JetBrains Mono", monospace`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(Math.max(0, Math.floor(m / 1000))).padStart(2, '0'), cx, cy + r * 0.30 + bh / 2);
    g.restore();
    this.needle(cx, cy, r, hundreds, 0.78, 0.030);
  }

  /** ЧИСЛО М and ПЕРЕГРУЗКА on one face: Mach outside, load factor inside. */
  private mach(cx: number, cy: number, r: number, mach: number, gLoad: number) {
    const g = this.g;
    this.face(cx, cy, r, 'ЧИСЛО М', '');
    const a0 = -2.36, a1 = 2.36;
    const toA = (v: number) => a0 + (a1 - a0) * Math.min(Math.max(v, 0), 2.5) / 2.5;
    this.ticks(cx, cy, r, a0, a1, 10, 2, (i) => (i * 0.25).toFixed(1).replace('0.', '.'));
    // Red radial at the never-exceed Mach.
    g.save();
    g.strokeStyle = '#c9342a'; g.lineWidth = r * 0.05;
    g.beginPath(); g.arc(cx, cy, r * 0.80, toA(2.3) - Math.PI / 2, toA(2.5) - Math.PI / 2); g.stroke();
    // Load factor readout in the lower half of the same instrument.
    g.fillStyle = '#040504'; g.strokeStyle = '#3a3f3c'; g.lineWidth = r * 0.02;
    const bw = r * 0.66, bh = r * 0.22;
    g.beginPath(); g.rect(cx - bw / 2, cy + r * 0.26, bw, bh); g.fill(); g.stroke();
    g.fillStyle = Math.abs(gLoad) > 8 ? '#ff6a52' : '#eef2ec';
    g.font = `600 ${r * 0.15}px "JetBrains Mono", monospace`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(`${gLoad >= 0 ? '' : '-'}${Math.abs(gLoad).toFixed(1)}g`, cx, cy + r * 0.26 + bh / 2);
    g.fillStyle = 'rgba(200,208,200,0.5)'; g.font = `400 ${r * 0.078}px Inter, Arial`;
    g.fillText('ПЕРЕГРУЗКА', cx, cy + r * 0.60);
    g.restore();
    this.needle(cx, cy, r, toA(mach), 0.72, 0.030);
  }

  /** КУРС — a rotating compass card with a fixed index. */
  private heading(cx: number, cy: number, r: number, hdg: number) {
    const g = this.g;
    this.face(cx, cy, r, '', '');
    g.save();
    g.beginPath(); g.arc(cx, cy, r * 0.90, 0, TAU); g.clip();
    g.translate(cx, cy); g.rotate(-hdg);
    g.strokeStyle = 'rgba(235,240,235,0.9)'; g.fillStyle = 'rgba(235,240,235,0.95)';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const names: Record<number, string> = { 0: 'С', 90: 'В', 180: 'Ю', 270: 'З' };
    for (let d = 0; d < 360; d += 5) {
      const a = d * Math.PI / 180;
      const major = d % 30 === 0;
      g.lineWidth = major ? r * 0.030 : r * 0.015;
      const l = major ? r * 0.14 : r * 0.075;
      g.beginPath();
      g.moveTo(Math.sin(a) * r * 0.88, -Math.cos(a) * r * 0.88);
      g.lineTo(Math.sin(a) * (r * 0.88 - l), -Math.cos(a) * (r * 0.88 - l));
      g.stroke();
      if (major) {
        g.save();
        g.translate(Math.sin(a) * r * 0.62, -Math.cos(a) * r * 0.62);
        g.rotate(a);
        g.font = `600 ${(names[d] ? r * 0.20 : r * 0.15)}px Inter, Arial`;
        g.fillText(names[d] ?? String(d / 10), 0, 0);
        g.restore();
      }
    }
    g.restore();
    g.fillStyle = '#f0c419';
    g.beginPath();
    g.moveTo(cx, cy - r * 0.88); g.lineTo(cx + r * 0.06, cy - r * 0.99); g.lineTo(cx - r * 0.06, cy - r * 0.99);
    g.fill();
    g.strokeStyle = '#eef2ec'; g.lineWidth = r * 0.03; g.lineCap = 'round';
    g.beginPath();
    g.moveTo(cx - r * 0.30, cy); g.lineTo(cx + r * 0.30, cy);
    g.moveTo(cx, cy - r * 0.22); g.lineTo(cx, cy + r * 0.26);
    g.stroke();
    g.fillStyle = 'rgba(226,232,226,0.72)';
    g.textAlign = 'center'; g.font = `600 ${r * 0.10}px Inter, Arial`;
    g.fillText('КУРС', cx, cy + r * 0.72);
  }

  /** ВАРИОМЕТР — vertical speed in m/s, with the angle-of-attack index alongside. */
  private vario(cx: number, cy: number, r: number, vs: number, aoaDeg: number) {
    const g = this.g;
    this.face(cx, cy, r, 'ВАРИОМЕТР', 'м/с');
    const toA = (v: number) => -Math.PI / 2 + (Math.max(-100, Math.min(100, v)) / 100) * 2.95;
    this.ticks(cx, cy, r, toA(-100), toA(100), 10, 5, (i) => {
      const v = -100 + i * 20;
      return i % 5 === 0 ? String(Math.abs(v)) : null;
    });
    g.save();
    g.fillStyle = 'rgba(200,208,200,0.5)'; g.font = `400 ${r * 0.085}px Inter, Arial`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('ВВЕРХ', cx + r * 0.44, cy - r * 0.40);
    g.fillText('ВНИЗ', cx + r * 0.44, cy + r * 0.44);
    // Angle of attack, the number a fighter pilot actually flies the approach on.
    g.fillStyle = '#040504'; g.strokeStyle = '#3a3f3c'; g.lineWidth = r * 0.02;
    const bw = r * 0.56, bh = r * 0.19;
    g.beginPath(); g.rect(cx - bw / 2, cy + r * 0.22, bw, bh); g.fill(); g.stroke();
    g.fillStyle = aoaDeg > 22 ? '#ff6a52' : '#eef2ec';
    g.font = `600 ${r * 0.13}px "JetBrains Mono", monospace`;
    g.fillText(`α ${aoaDeg.toFixed(0)}°`, cx, cy + r * 0.22 + bh / 2);
    g.restore();
    this.needle(cx, cy, r, toA(vs), 0.76, 0.028);
  }

  /** The strip of caution lights and readouts below the dials. */
  private readouts(s: FlightState) {
    const g = this.g, S = this.size;
    const lamps: [number, string, boolean, string][] = [
      [0.027, 'ШАССИ', s.gear > 0.98, '#3ad46a'],
      [0.196, 'ФОРСАЖ', s.afterburner > 0.05, '#ff8a2a'],
      [0.365, 'ПЕРЕГРУЗКА', s.overG > 0.15, '#ff4a3a'],
      [0.534, 'СРЫВ', s.stall > 0.35 && !s.onGround, '#ff4a3a'],
      [0.703, 'ЗАКРЫЛКИ', s.flaps > 0.05, '#3ad46a'],
    ];
    for (const [x, label, on, colour] of lamps) {
      const w = 0.155, y = 0.768, h = 0.088;
      g.fillStyle = on ? colour : '#161a17';
      g.globalAlpha = on ? 0.92 : 1;
      g.fillRect(x * S, y * S, w * S, h * S);
      g.globalAlpha = 1;
      g.strokeStyle = '#2a2e2b'; g.lineWidth = S * 0.003;
      g.strokeRect(x * S, y * S, w * S, h * S);
      g.fillStyle = on ? 'rgba(10,10,8,0.92)' : 'rgba(190,198,190,0.42)';
      g.font = `600 ${h * S * 0.42}px Inter, Arial`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(label, (x + w / 2) * S, (y + h / 2) * S);
    }
    // Engine and fuel line.
    g.fillStyle = 'rgba(200,208,200,0.66)';
    g.font = `500 ${S * 0.030}px Inter, Arial`;
    g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText(`ОБОРОТЫ ${Math.round(s.rpm)}%`, 0.030 * S, 0.910 * S);
    g.textAlign = 'right';
    g.fillText(`ТЯГА ${Math.round(s.throttle * 100)}%`, 0.970 * S, 0.910 * S);
  }
}
