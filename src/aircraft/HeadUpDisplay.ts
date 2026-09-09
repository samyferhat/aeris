import * as THREE from 'three';
import { FlightState } from './FlightModel';

/**
 * Symbology drawn on the fighter's combiner glass.
 *
 * A head-up display is collimated: the symbols are focused at infinity so they sit on
 * the world rather than on the glass, and the flight-path marker lands exactly where
 * the aircraft is actually going. That is reproduced here by projecting the velocity
 * vector into the pilot's field of view and drawing the marker at that angle, with the
 * pitch ladder pinned to it. Everything is phosphor green on a transparent ground, as
 * a real combiner is.
 */
export class HeadUpDisplay {
  readonly texture: THREE.CanvasTexture;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private size: number;
  private lastDraw = -1;
  /** Half-angle the glass subtends, radians — sets the symbology scale. */
  private fov = THREE.MathUtils.degToRad(11);

  constructor(size = 1024) {
    this.size = size;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = size;
    this.g = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.flipY = false;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
  }

  update(s: FlightState, now: number) {
    if (now - this.lastDraw < 50) return;
    this.lastDraw = now;
    this.draw(s);
  }

  private draw(s: FlightState) {
    const g = this.g, S = this.size, C = S / 2;
    g.clearRect(0, 0, S, S);
    const px = C / this.fov;                 // pixels per radian
    const green = '#7dff9a';
    g.strokeStyle = green; g.fillStyle = green;
    g.lineWidth = S * 0.0045; g.lineCap = 'round'; g.lineJoin = 'round';
    g.font = `500 ${S * 0.032}px "JetBrains Mono", monospace`;
    g.textBaseline = 'middle';

    // Flight-path marker: where the aeroplane is going, not where it is pointing.
    const fpaY = (s.pitch - s.alpha) - s.pitch;   // depression of the velocity vector
    const driftX = -s.beta;
    const mx = C + Math.max(-C * 0.7, Math.min(C * 0.7, driftX * px));
    const my = C - Math.max(-C * 0.7, Math.min(C * 0.7, fpaY * px));
    g.beginPath();
    g.arc(mx, my, S * 0.026, 0, Math.PI * 2);
    g.moveTo(mx - S * 0.026, my); g.lineTo(mx - S * 0.062, my);
    g.moveTo(mx + S * 0.026, my); g.lineTo(mx + S * 0.062, my);
    g.moveTo(mx, my - S * 0.026); g.lineTo(mx, my - S * 0.052);
    g.stroke();

    // Pitch ladder, rolled with the aircraft and hung off the marker.
    g.save();
    g.translate(mx, my);
    g.rotate(-s.bank);
    for (let d = -60; d <= 60; d += 5) {
      const ang = d * Math.PI / 180 - (s.pitch - s.alpha) + (s.pitch - s.alpha);
      const y = -(d * Math.PI / 180 - s.pitch) * px;
      if (Math.abs(y) > C * 0.8) continue;
      const major = d % 10 === 0;
      if (!major && d !== 0) continue;
      const w = d === 0 ? S * 0.30 : S * 0.13;
      const gap = S * 0.055;
      g.setLineDash(d < 0 ? [S * 0.022, S * 0.016] : []);
      g.beginPath();
      g.moveTo(-w - gap, y); g.lineTo(-gap, y);
      if (d !== 0) g.lineTo(-gap, y + (d > 0 ? S * 0.018 : -S * 0.018));
      g.moveTo(gap, y); g.lineTo(w + gap, y);
      if (d !== 0) g.lineTo(gap, y + (d > 0 ? S * 0.018 : -S * 0.018));
      g.stroke();
      if (d !== 0) {
        g.setLineDash([]);
        g.textAlign = 'right';
        g.fillText(String(Math.abs(d)), -w - gap - S * 0.012, y);
        g.textAlign = 'left';
        g.fillText(String(Math.abs(d)), w + gap + S * 0.012, y);
      }
    }
    g.setLineDash([]);
    g.restore();

    // Boresight cross: where the nose points.
    g.beginPath();
    g.moveTo(C - S * 0.018, C); g.lineTo(C + S * 0.018, C);
    g.moveTo(C, C - S * 0.018); g.lineTo(C, C + S * 0.018);
    g.stroke();

    // Speed on the left, altitude on the right, both boxed as on a real combiner.
    const box = (x: number, text: string, align: CanvasTextAlign) => {
      const w = S * 0.155, h = S * 0.055;
      g.strokeRect(x - (align === 'right' ? w : 0), C - h / 2, w, h);
      g.textAlign = 'center';
      g.fillText(text, x - (align === 'right' ? w / 2 : -w / 2), C);
    };
    box(C - S * 0.30, `${Math.round(s.indicatedSpeed * 3.6)}`, 'right');
    box(C + S * 0.30, `${Math.round(s.altitude)}`, 'left');
    g.font = `400 ${S * 0.024}px Inter, Arial`;
    g.textAlign = 'center';
    g.fillText('км/ч', C - S * 0.30 - S * 0.078, C + S * 0.052);
    g.fillText('м', C + S * 0.30 + S * 0.078, C + S * 0.052);

    // Mach and load factor under the speed box; vertical speed under the altitude box.
    g.font = `500 ${S * 0.028}px "JetBrains Mono", monospace`;
    g.textAlign = 'right';
    g.fillText(`M ${s.mach.toFixed(2)}`, C - S * 0.225, C - S * 0.10);
    g.fillText(`${s.gLoad.toFixed(1)}G`, C - S * 0.225, C + S * 0.10);
    g.textAlign = 'left';
    g.fillText(`${s.verticalSpeed >= 0 ? '+' : ''}${s.verticalSpeed.toFixed(0)}`, C + S * 0.225, C - S * 0.10);
    g.fillText(`α ${(s.alpha * 57.3).toFixed(0)}`, C + S * 0.225, C + S * 0.10);

    // Heading scale across the top.
    const hdg = s.heading * 180 / Math.PI;
    g.save();
    g.beginPath(); g.rect(C - S * 0.26, C - S * 0.44, S * 0.52, S * 0.10); g.clip();
    g.font = `500 ${S * 0.026}px "JetBrains Mono", monospace`;
    g.textAlign = 'center';
    for (let d = -40; d <= 40; d += 5) {
      const value = ((Math.round(hdg / 5) * 5 + d) % 360 + 360) % 360;
      const x = C + (value - hdg + (value - hdg > 180 ? -360 : value - hdg < -180 ? 360 : 0)) * S * 0.0075;
      const major = value % 10 === 0;
      g.beginPath();
      g.moveTo(x, C - S * 0.40); g.lineTo(x, C - S * 0.40 + (major ? S * 0.020 : S * 0.011));
      g.stroke();
      if (major) g.fillText(String(value / 10).padStart(2, '0'), x, C - S * 0.425);
    }
    g.restore();
    g.beginPath();
    g.moveTo(C, C - S * 0.375); g.lineTo(C - S * 0.010, C - S * 0.362); g.lineTo(C + S * 0.010, C - S * 0.362);
    g.closePath(); g.fill();

    // Caution and configuration cues along the bottom.
    g.font = `600 ${S * 0.030}px Inter, Arial`;
    g.textAlign = 'center';
    const cues: string[] = [];
    if (s.gear > 0.98) cues.push('ШАССИ');
    if (s.afterburner > 0.05) cues.push('ФОРСАЖ');
    if (s.flaps > 0.05) cues.push('ЗАКРЫЛКИ');
    if (cues.length) g.fillText(cues.join('   '), C, C + S * 0.34);
    if (s.overG > 0.15 || (s.stall > 0.35 && !s.onGround)) {
      g.fillStyle = '#ff9a6a';
      g.fillText(s.overG > 0.15 ? 'ПЕРЕГРУЗКА' : 'СРЫВ', C, C + S * 0.40);
    }
    this.texture.needsUpdate = true;
  }
}
