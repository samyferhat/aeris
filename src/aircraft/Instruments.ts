import * as THREE from 'three';
import { FlightState } from './FlightModel';

const MS_TO_KT = 1.94384, M_TO_FT = 3.28084;
const TAU = Math.PI * 2;

/**
 * Live instrument panel.
 *
 * The panel mesh comes out of Blender with a single atlas mapped across it: six round
 * dials on a 3x3 grid (top two rows) and three radio windows below. Rather than ship a
 * still image of that atlas, it is redrawn on a canvas from the flight state, so the
 * six-pack actually flies: the needles, the horizon, the compass card and the slip ball
 * all move. Redrawn at ~20 Hz, which is under the eye's threshold for a needle and a
 * fifth of the upload cost of doing it every frame.
 */
export class Instruments {
  readonly texture: THREE.CanvasTexture;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private size: number;
  private cell: number;
  private lastDraw = -1;
  /** Damped values, so needles have the lag of a real mechanism. */
  private d = { ias: 0, alt: 0, vs: 0, hdg: 0, pitch: 0, bank: 0, turn: 0, slip: 0 };

  constructor(size = 1024) {
    this.size = size;
    this.cell = size / 3;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = size;
    this.g = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    // The glTF atlas was authored unflipped; match it so the layout lines up.
    this.texture.flipY = false;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.generateMipmaps = true;
    this.draw({
      airspeed: 0, groundSpeed: 0, alpha: 0, beta: 0, gLoad: 1, altitude: 0, heightAGL: 0, heading: 0,
      pitch: 0, bank: 0, verticalSpeed: 0, rpm: 0, onGround: true, stall: 0, throttle: 0, flaps: 0,
      wheelCompression: [], wheelOnGround: [], wheelSlip: 0,
    }, 1);
  }

  update(s: FlightState, dt: number, now: number) {
    if (now - this.lastDraw < 50) return;
    const step = Math.min(1, (now - this.lastDraw) / 1000 * 6);
    this.lastDraw = now;
    this.draw(s, step < 0 ? 1 : step);
  }

  private lerpTo(key: keyof Instruments['d'], target: number, k: number) {
    this.d[key] += (target - this.d[key]) * k;
    return this.d[key];
  }

  private draw(s: FlightState, k: number) {
    const g = this.g, S = this.size, C = this.cell;
    g.fillStyle = '#050506';
    g.fillRect(0, 0, S, S);

    const ias = this.lerpTo('ias', s.airspeed * MS_TO_KT, k * 0.7);
    const alt = this.lerpTo('alt', s.altitude * M_TO_FT, k * 0.8);
    const vs = this.lerpTo('vs', s.verticalSpeed * M_TO_FT * 60, k * 0.35);
    const pitch = this.lerpTo('pitch', s.pitch, k);
    const bank = this.lerpTo('bank', s.bank, k);
    // Rate of turn from the bank angle (coordinated-turn approximation).
    const turnRate = Math.tan(bank) * 9.81 / Math.max(s.airspeed, 20);
    this.lerpTo('turn', turnRate, k * 0.6);
    this.lerpTo('slip', s.beta, k * 0.5);
    // Unwrap the heading so the card takes the short way round.
    const hdgTarget = s.heading;
    let diff = hdgTarget - this.d.hdg;
    while (diff > Math.PI) diff -= TAU;
    while (diff < -Math.PI) diff += TAU;
    this.d.hdg += diff * k * 0.8;

    this.airspeed(0.5 * C, 0.5 * C, C * 0.45, ias);
    this.attitude(1.5 * C, 0.5 * C, C * 0.45, pitch, bank);
    this.altimeter(2.5 * C, 0.5 * C, C * 0.45, alt);
    this.turnCoordinator(0.5 * C, 1.5 * C, C * 0.45, this.d.turn, this.d.slip);
    this.heading(1.5 * C, 1.5 * C, C * 0.45, this.d.hdg);
    this.vsi(2.5 * C, 1.5 * C, C * 0.45, vs);
    this.radios(s);
    this.texture.needsUpdate = true;
  }

  // ---- shared dial furniture ----------------------------------------------
  private face(cx: number, cy: number, r: number, label: string, sub?: string) {
    const g = this.g;
    g.save();
    const grd = g.createRadialGradient(cx - r * 0.3, cy - r * 0.4, r * 0.1, cx, cy, r * 1.05);
    grd.addColorStop(0, '#232426'); grd.addColorStop(0.65, '#111214'); grd.addColorStop(1, '#050506');
    g.fillStyle = grd;
    g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
    g.strokeStyle = '#3a3d42'; g.lineWidth = r * 0.055;
    g.beginPath(); g.arc(cx, cy, r * 0.985, 0, TAU); g.stroke();
    g.fillStyle = 'rgba(230,235,240,0.72)';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `600 ${r * 0.115}px Inter, Arial, sans-serif`;
    g.fillText(label, cx, cy - r * 0.30);
    if (sub) { g.font = `400 ${r * 0.085}px Inter, Arial, sans-serif`; g.fillStyle = 'rgba(210,215,220,0.5)'; g.fillText(sub, cx, cy - r * 0.16); }
    g.restore();
  }

  private needle(cx: number, cy: number, r: number, angle: number, len: number, width: number, color = '#f2f4f7') {
    const g = this.g;
    g.save();
    g.translate(cx, cy); g.rotate(angle);
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(-width * r, -r * 0.06);
    g.lineTo(0, -r * len);
    g.lineTo(width * r, -r * 0.06);
    g.lineTo(width * r * 0.5, r * 0.22);
    g.lineTo(-width * r * 0.5, r * 0.22);
    g.closePath(); g.fill();
    g.restore();
    g.fillStyle = '#0a0a0b';
    g.beginPath(); g.arc(cx, cy, r * 0.055, 0, TAU); g.fill();
    g.strokeStyle = '#4a4d52'; g.lineWidth = r * 0.012; g.stroke();
  }

  private ticks(cx: number, cy: number, r: number, from: number, to: number, count: number, major: number, labels?: (i: number) => string | null) {
    const g = this.g;
    g.save(); g.strokeStyle = 'rgba(235,240,245,0.85)'; g.fillStyle = 'rgba(235,240,245,0.9)';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let i = 0; i <= count; i++) {
      const a = from + (to - from) * (i / count);
      const isMajor = i % major === 0;
      const l = isMajor ? r * 0.16 : r * 0.09;
      g.lineWidth = isMajor ? r * 0.035 : r * 0.018;
      g.beginPath();
      g.moveTo(cx + Math.sin(a) * (r * 0.86), cy - Math.cos(a) * (r * 0.86));
      g.lineTo(cx + Math.sin(a) * (r * 0.86 - l), cy - Math.cos(a) * (r * 0.86 - l));
      g.stroke();
      const txt = isMajor && labels ? labels(i) : null;
      if (txt) {
        g.font = `600 ${r * 0.155}px Inter, Arial, sans-serif`;
        g.fillText(txt, cx + Math.sin(a) * (r * 0.60), cy - Math.cos(a) * (r * 0.60));
      }
    }
    g.restore();
  }

  // ---- the six-pack --------------------------------------------------------
  private airspeed(cx: number, cy: number, r: number, kt: number) {
    const g = this.g;
    this.face(cx, cy, r, 'AIRSPEED', 'KNOTS');
    // Arc scale: 40 kt at -150 deg through 200 kt at +150 deg.
    const a0 = -2.618, a1 = 2.618, v0 = 40, v1 = 200;
    const toA = (v: number) => a0 + (a1 - a0) * (Math.min(Math.max(v, v0), v1) - v0) / (v1 - v0);
    // Colour arcs: white flap range, green normal, yellow caution, red never-exceed.
    const arc = (from: number, to: number, color: string, rad: number, w: number) => {
      g.strokeStyle = color; g.lineWidth = r * w; g.lineCap = 'butt';
      g.beginPath(); g.arc(cx, cy, r * rad, toA(from) - Math.PI / 2, toA(to) - Math.PI / 2); g.stroke();
    };
    arc(40, 85, '#e8eaee', 0.93, 0.055);
    arc(48, 129, '#39b54a', 0.86, 0.055);
    arc(129, 160, '#e9c93a', 0.86, 0.055);
    arc(160, 165, '#d0342c', 0.86, 0.075);
    this.ticks(cx, cy, r, toA(40), toA(200), 16, 2, (i) => String(40 + i * 10));
    this.needle(cx, cy, r, toA(kt), 0.78, 0.035);
  }

  private attitude(cx: number, cy: number, r: number, pitch: number, bank: number) {
    const g = this.g;
    g.save();
    g.beginPath(); g.arc(cx, cy, r * 0.93, 0, TAU); g.clip();
    g.translate(cx, cy); g.rotate(-bank);
    const pxPerRad = r * 1.5;
    const off = pitch * pxPerRad;
    // Sky and ground.
    g.fillStyle = '#2f78c4'; g.fillRect(-r * 2, -r * 2 + off, r * 4, r * 2);
    g.fillStyle = '#7a4a22'; g.fillRect(-r * 2, off, r * 4, r * 2);
    g.strokeStyle = '#f4f6f8'; g.lineWidth = r * 0.03;
    g.beginPath(); g.moveTo(-r * 2, off); g.lineTo(r * 2, off); g.stroke();
    // Pitch ladder.
    g.lineWidth = r * 0.02; g.fillStyle = '#f4f6f8';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `500 ${r * 0.10}px Inter, Arial, sans-serif`;
    for (let d = -30; d <= 30; d += 10) {
      if (d === 0) continue;
      const y = off - (d * Math.PI / 180) * pxPerRad;
      const w = r * 0.34;
      g.beginPath(); g.moveTo(-w, y); g.lineTo(w, y); g.stroke();
      g.fillText(String(Math.abs(d)), -w - r * 0.13, y);
      g.fillText(String(Math.abs(d)), w + r * 0.13, y);
    }
    g.restore();
    // Bank index and fixed aircraft symbol.
    g.save();
    g.strokeStyle = '#e8eaee'; g.lineWidth = r * 0.03;
    for (const a of [-60, -45, -30, -20, -10, 10, 20, 30, 45, 60]) {
      const rad = a * Math.PI / 180, len = a % 30 === 0 ? r * 0.11 : r * 0.06;
      g.beginPath();
      g.moveTo(cx + Math.sin(rad) * r * 0.93, cy - Math.cos(rad) * r * 0.93);
      g.lineTo(cx + Math.sin(rad) * (r * 0.93 - len), cy - Math.cos(rad) * (r * 0.93 - len));
      g.stroke();
    }
    g.fillStyle = '#e9c93a';
    g.beginPath();
    g.moveTo(cx + Math.sin(-bank) * r * 0.90, cy - Math.cos(-bank) * r * 0.90);
    g.lineTo(cx + Math.sin(-bank - 0.06) * r * 0.78, cy - Math.cos(-bank - 0.06) * r * 0.78);
    g.lineTo(cx + Math.sin(-bank + 0.06) * r * 0.78, cy - Math.cos(-bank + 0.06) * r * 0.78);
    g.fill();
    g.strokeStyle = '#f0a91e'; g.lineWidth = r * 0.055; g.lineCap = 'round';
    g.beginPath();
    g.moveTo(cx - r * 0.42, cy); g.lineTo(cx - r * 0.14, cy);
    g.moveTo(cx + r * 0.14, cy); g.lineTo(cx + r * 0.42, cy);
    g.moveTo(cx, cy - r * 0.02); g.lineTo(cx, cy + r * 0.10);
    g.stroke();
    g.strokeStyle = '#3a3d42'; g.lineWidth = r * 0.06;
    g.beginPath(); g.arc(cx, cy, r * 0.96, 0, TAU); g.stroke();
    g.restore();
  }

  private altimeter(cx: number, cy: number, r: number, ft: number) {
    const g = this.g;
    this.face(cx, cy, r, 'ALT', 'FEET');
    this.ticks(cx, cy, r, 0, TAU, 10, 1, (i) => (i === 10 ? null : String(i)));
    // Kollsman window.
    g.save();
    g.fillStyle = '#0b0c0d'; g.strokeStyle = '#4a4d52'; g.lineWidth = r * 0.02;
    const bw = r * 0.42, bh = r * 0.17;
    g.beginPath(); g.rect(cx + r * 0.30, cy - bh / 2, bw, bh); g.fill(); g.stroke();
    g.fillStyle = '#e8eaee'; g.font = `600 ${r * 0.12}px "JetBrains Mono", monospace`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('29.92', cx + r * 0.30 + bw / 2, cy);
    g.restore();
    const hundreds = ((ft % 1000) / 1000) * TAU;
    const thousands = ((ft % 10000) / 10000) * TAU;
    const tenThousands = ((ft % 100000) / 100000) * TAU;
    // Ten-thousands pointer is a small triangle riding near the rim.
    g.save(); g.translate(cx, cy); g.rotate(tenThousands); g.fillStyle = '#cfd3d8';
    g.beginPath(); g.moveTo(0, -r * 0.80); g.lineTo(r * 0.055, -r * 0.66); g.lineTo(-r * 0.055, -r * 0.66); g.closePath(); g.fill();
    g.restore();
    this.needle(cx, cy, r, thousands, 0.52, 0.055, '#dfe3e8');
    this.needle(cx, cy, r, hundreds, 0.80, 0.030, '#f4f6f8');
  }

  private turnCoordinator(cx: number, cy: number, r: number, turnRate: number, slip: number) {
    const g = this.g;
    this.face(cx, cy, r, 'TURN COORDINATOR');
    // Standard rate = 3 deg/s; the wings tilt to the index mark at that rate.
    const std = 3 * Math.PI / 180;
    const tilt = Math.max(-1.4, Math.min(1.4, turnRate / std)) * 0.35;
    g.save();
    g.strokeStyle = 'rgba(235,240,245,0.8)'; g.lineWidth = r * 0.03;
    for (const sgn of [-1, 1]) {
      g.beginPath();
      g.moveTo(cx + sgn * r * 0.52, cy - r * 0.08);
      g.lineTo(cx + sgn * r * 0.72, cy - r * 0.08);
      g.stroke();
      g.font = `600 ${r * 0.13}px Inter, Arial`; g.fillStyle = 'rgba(235,240,245,0.75)';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(sgn < 0 ? 'L' : 'R', cx + sgn * r * 0.62, cy - r * 0.26);
    }
    g.translate(cx, cy); g.rotate(tilt);
    g.strokeStyle = '#f4f6f8'; g.lineWidth = r * 0.055; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-r * 0.55, 0); g.lineTo(r * 0.55, 0); g.stroke();
    g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -r * 0.20); g.stroke();
    g.fillStyle = '#f4f6f8';
    g.beginPath(); g.arc(0, 0, r * 0.075, 0, TAU); g.fill();
    g.restore();
    // Inclinometer: the ball slides opposite the lateral acceleration.
    g.save();
    const by = cy + r * 0.52, bx = cx + Math.max(-1, Math.min(1, slip * 3.2)) * r * 0.26;
    g.fillStyle = '#191a1c'; g.strokeStyle = '#4a4d52'; g.lineWidth = r * 0.02;
    g.beginPath(); g.roundRect(cx - r * 0.40, by - r * 0.10, r * 0.80, r * 0.20, r * 0.10); g.fill(); g.stroke();
    g.strokeStyle = 'rgba(235,240,245,0.55)'; g.lineWidth = r * 0.018;
    for (const sgn of [-1, 1]) { g.beginPath(); g.moveTo(cx + sgn * r * 0.09, by - r * 0.10); g.lineTo(cx + sgn * r * 0.09, by + r * 0.10); g.stroke(); }
    const bg = g.createRadialGradient(bx - r * 0.02, by - r * 0.03, r * 0.01, bx, by, r * 0.085);
    bg.addColorStop(0, '#3b3d40'); bg.addColorStop(1, '#0d0e0f');
    g.fillStyle = bg;
    g.beginPath(); g.arc(bx, by, r * 0.075, 0, TAU); g.fill();
    g.font = `400 ${r * 0.085}px Inter, Arial`; g.fillStyle = 'rgba(200,205,210,0.5)';
    g.textAlign = 'center'; g.fillText('2 MIN', cx, by + r * 0.26);
    g.restore();
  }

  private heading(cx: number, cy: number, r: number, hdg: number) {
    const g = this.g;
    this.face(cx, cy, r, '');
    g.save();
    g.beginPath(); g.arc(cx, cy, r * 0.92, 0, TAU); g.clip();
    g.translate(cx, cy); g.rotate(-hdg);
    g.strokeStyle = 'rgba(240,244,248,0.9)'; g.fillStyle = 'rgba(240,244,248,0.95)';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const names: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
    for (let d = 0; d < 360; d += 5) {
      const a = d * Math.PI / 180;
      const major = d % 30 === 0;
      g.lineWidth = major ? r * 0.032 : r * 0.016;
      const l = major ? r * 0.15 : r * 0.08;
      g.beginPath();
      g.moveTo(Math.sin(a) * r * 0.90, -Math.cos(a) * r * 0.90);
      g.lineTo(Math.sin(a) * (r * 0.90 - l), -Math.cos(a) * (r * 0.90 - l));
      g.stroke();
      if (major) {
        const txt = names[d] ?? String(d / 10);
        g.save();
        g.translate(Math.sin(a) * r * 0.63, -Math.cos(a) * r * 0.63);
        g.rotate(a);
        g.font = `600 ${(names[d] ? r * 0.20 : r * 0.16)}px Inter, Arial`;
        g.fillText(txt, 0, 0);
        g.restore();
      }
    }
    g.restore();
    // Fixed aircraft silhouette and the lubber line.
    g.save();
    g.fillStyle = '#f0a91e';
    g.beginPath();
    g.moveTo(cx, cy - r * 0.34);
    g.lineTo(cx + r * 0.055, cy - r * 0.06);
    g.lineTo(cx + r * 0.42, cy + r * 0.02);
    g.lineTo(cx + r * 0.42, cy + r * 0.12);
    g.lineTo(cx + r * 0.055, cy + r * 0.10);
    g.lineTo(cx + r * 0.05, cy + r * 0.26);
    g.lineTo(cx + r * 0.19, cy + r * 0.33);
    g.lineTo(cx + r * 0.19, cy + r * 0.40);
    g.lineTo(cx, cy + r * 0.35);
    g.lineTo(cx - r * 0.19, cy + r * 0.40);
    g.lineTo(cx - r * 0.19, cy + r * 0.33);
    g.lineTo(cx - r * 0.05, cy + r * 0.26);
    g.lineTo(cx - r * 0.055, cy + r * 0.10);
    g.lineTo(cx - r * 0.42, cy + r * 0.12);
    g.lineTo(cx - r * 0.42, cy + r * 0.02);
    g.lineTo(cx - r * 0.055, cy - r * 0.06);
    g.closePath(); g.fill();
    g.fillStyle = '#e8eaee';
    g.beginPath(); g.moveTo(cx, cy - r * 0.90); g.lineTo(cx + r * 0.06, cy - r * 0.99); g.lineTo(cx - r * 0.06, cy - r * 0.99); g.fill();
    g.restore();
  }

  private vsi(cx: number, cy: number, r: number, fpm: number) {
    const g = this.g;
    this.face(cx, cy, r, 'VERTICAL SPEED', '100 FEET PER MINUTE');
    // -2000..+2000 fpm mapped over +-170 deg, zero pointing left (9 o'clock).
    const toA = (v: number) => -Math.PI / 2 + (Math.max(-2000, Math.min(2000, v)) / 2000) * 2.97;
    this.ticks(cx, cy, r, toA(-2000), toA(2000), 20, 5, (i) => {
      const v = -2000 + i * 200;
      return i % 5 === 0 ? String(Math.abs(v) / 100) : null;
    });
    g.save();
    g.fillStyle = 'rgba(230,235,240,0.6)'; g.font = `500 ${r * 0.10}px Inter, Arial`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('UP', cx + r * 0.46, cy - r * 0.40);
    g.fillText('DOWN', cx + r * 0.42, cy + r * 0.44);
    g.restore();
    this.needle(cx, cy, r, toA(fpm), 0.78, 0.028);
  }

  private radios(s: FlightState) {
    const g = this.g, S = this.size;
    const boxes: [number, number, number, number, string][] = [
      [0.027, 0.768, 0.276, 0.140, '118.30'],
      [0.361, 0.768, 0.274, 0.140, '121.50'],
      [0.693, 0.768, 0.278, 0.140, String(4521)],
    ];
    for (const [x, y, w, h, txt] of boxes) {
      g.fillStyle = '#040405';
      g.fillRect(x * S, y * S, w * S, h * S);
      g.strokeStyle = '#2a2c30'; g.lineWidth = S * 0.003;
      g.strokeRect(x * S, y * S, w * S, h * S);
      g.fillStyle = '#ff9a1e';
      g.font = `600 ${h * S * 0.62}px "JetBrains Mono", monospace`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.shadowColor = '#ff7a00'; g.shadowBlur = S * 0.012;
      g.fillText(txt, (x + w / 2) * S, (y + h / 2) * S);
      g.shadowBlur = 0;
    }
    // Engine tachometer strip under the radios.
    g.fillStyle = 'rgba(190,196,204,0.65)';
    g.font = `500 ${S * 0.030}px Inter, Arial`;
    g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText(`RPM ${Math.round(s.rpm / 10) * 10}`, 0.030 * S, 0.955 * S);
    g.textAlign = 'right';
    g.fillText(`FLAPS ${Math.round(s.flaps * 30)}°`, 0.970 * S, 0.955 * S);
  }
}
