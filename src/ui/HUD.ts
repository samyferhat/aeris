import { FlightState } from '../aircraft/FlightModel';
import { CameraMode } from '../aircraft/Cameras';

const MS_TO_KT = 1.94384, M_TO_FT = 3.28084;

/** Minimal, elegant HUD: speed/altitude tapes, heading strip, attitude sphere, status. */
export class HUD {
  private root: HTMLElement;
  private speedStrip!: HTMLElement; private speedBox!: HTMLElement;
  private altStrip!: HTMLElement; private altBox!: HTMLElement; private vs!: HTMLElement;
  private headStrip!: HTMLElement; private headBox!: HTMLElement;
  private att!: HTMLCanvasElement; private ctx!: CanvasRenderingContext2D;
  private thrBar!: HTMLElement; private flapBar!: HTMLElement; private rpmVal!: HTMLElement; private gVal!: HTMLElement;
  private warn!: HTMLElement; private camLabel!: HTMLElement; private hint!: HTMLElement; private crash!: HTMLElement;
  private hintTimer = 0;
  visible = true;

  constructor() {
    this.root = document.getElementById('hud')!;
    this.root.innerHTML = `
      <div class="tape speed mono"><div class="strip"></div><div class="box"></div><div class="label">kt · ias</div></div>
      <div class="tape alt mono"><div class="strip"></div><div class="box"></div><div class="label">ft · alt</div></div>
      <div class="vs mono"></div>
      <div class="heading mono"><div class="strip"></div><div class="cursor"></div><div class="box"></div></div>
      <div class="attitude"><canvas width="520" height="520"></canvas></div>
      <div class="warn">STALL</div>
      <div class="status">
        <span>Gaz</span><div class="bar"><i class="thr"></i></div>
        <span>Volets</span><div class="bar"><i class="flap"></i></div>
        <span>RPM</span><span class="val mono rpm"></span>
        <span>G</span><span class="val mono g"></span>
      </div>
      <div class="cammode"></div>
      <div class="hint">Shift pour les gaz · flèches pour piloter · clic droit pour la souris · C caméra</div>
      <div class="crash"><div>IMPACT</div><small>R pour revenir sur la piste</small></div>`;
    const q = (s: string) => this.root.querySelector(s) as HTMLElement;
    this.speedStrip = q('.tape.speed .strip'); this.speedBox = q('.tape.speed .box');
    this.altStrip = q('.tape.alt .strip'); this.altBox = q('.tape.alt .box'); this.vs = q('.vs');
    this.headStrip = q('.heading .strip'); this.headBox = q('.heading .box');
    this.att = q('.attitude canvas') as HTMLCanvasElement; this.ctx = this.att.getContext('2d')!;
    this.thrBar = q('.thr'); this.flapBar = q('.flap'); this.rpmVal = q('.rpm'); this.gVal = q('.g');
    this.warn = q('.warn'); this.camLabel = q('.cammode'); this.hint = q('.hint'); this.crash = q('.crash');
    this.buildTape(this.speedStrip, 0, 200, 10, 2.6, true);
    this.buildTape(this.altStrip, -500, 12000, 100, 0.45, false);
    this.buildHeading();
  }

  toggle() { this.visible = !this.visible; this.root.classList.toggle('hidden', !this.visible); }

  private buildTape(strip: HTMLElement, min: number, max: number, step: number, pxPerUnit: number, right: boolean) {
    for (let v = min; v <= max; v += step) {
      const t = document.createElement('div');
      t.className = 'tick'; t.style.top = `${-v * pxPerUnit}px`;
      if (v % (step * 2) === 0) t.innerHTML = `<span>${v}</span>`;
      strip.appendChild(t);
    }
    (strip as any)._ppu = pxPerUnit;
  }

  private buildHeading() {
    const names: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
    for (let d = -180; d < 540; d += 5) {
      const t = document.createElement('div');
      const deg = ((d % 360) + 360) % 360;
      t.className = 'htick' + (deg % 30 === 0 ? ' major' : ''); t.style.left = `${d * 2.4}px`;
      if (deg % 30 === 0) t.innerHTML = `<div class="lbl">${names[deg] ?? deg}</div>`;
      this.headStrip.appendChild(t);
    }
  }

  update(s: FlightState, mode: CameraMode, dt: number, crashed: boolean) {
    const kt = s.airspeed * MS_TO_KT, ft = s.altitude * M_TO_FT;
    this.speedStrip.style.transform = `translateY(${kt * (this.speedStrip as any)._ppu}px)`;
    this.speedBox.textContent = Math.round(kt).toString().padStart(3, ' ');
    this.altStrip.style.transform = `translateY(${ft * (this.altStrip as any)._ppu}px)`;
    this.altBox.textContent = Math.round(ft / 10) * 10 + '';
    const fpm = Math.round(s.verticalSpeed * M_TO_FT * 60 / 50) * 50;
    this.vs.textContent = (fpm > 0 ? '▲ ' : fpm < 0 ? '▼ ' : '  ') + Math.abs(fpm) + ' fpm';
    const hdg = (s.heading * 180 / Math.PI);
    this.headStrip.style.transform = `translateX(${-hdg * 2.4}px)`;
    this.headBox.textContent = String(Math.round(hdg) % 360).padStart(3, '0') + '°';
    this.thrBar.style.width = `${s.throttle * 100}%`;
    this.flapBar.style.width = `${s.flaps * 100}%`;
    this.rpmVal.textContent = String(Math.round(s.rpm / 10) * 10);
    this.gVal.textContent = s.gLoad.toFixed(1);
    this.warn.classList.toggle('on', s.stall > 0.35 && !s.onGround);
    this.camLabel.textContent = mode === 'chase' ? 'caméra · poursuite' : mode === 'cockpit' ? 'caméra · cockpit' : 'caméra · libre';
    this.crash.classList.toggle('on', crashed);
    if (s.airspeed > 15) this.hintTimer += dt;
    if (this.hintTimer > 4) this.hint.classList.add('gone');
    this.drawAttitude(s);
  }

  private drawAttitude(s: FlightState) {
    const c = this.ctx, W = this.att.width, H = this.att.height, cx = W / 2, cy = H / 2;
    c.clearRect(0, 0, W, H);
    c.save();
    c.translate(cx, cy);
    c.rotate(s.bank);
    const pxPerDeg = 5.2;
    const pitchDeg = s.pitch * 180 / Math.PI;
    c.translate(0, pitchDeg * pxPerDeg);
    // Horizon line + pitch ladder (dimmed, sober)
    c.strokeStyle = 'rgba(235,242,248,0.85)'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(-95, 0); c.lineTo(-30, 0); c.moveTo(30, 0); c.lineTo(95, 0); c.stroke();
    c.font = '300 15px "JetBrains Mono", monospace'; c.fillStyle = 'rgba(235,242,248,0.6)'; c.textAlign = 'center';
    c.strokeStyle = 'rgba(235,242,248,0.5)'; c.lineWidth = 1.5;
    for (let d = -30; d <= 30; d += 10) {
      if (d === 0) continue;
      const y = -d * pxPerDeg, w = Math.abs(d) === 10 ? 26 : 34;
      c.setLineDash(d < 0 ? [6, 4] : []);
      c.beginPath(); c.moveTo(-w - 30, y); c.lineTo(-30, y); c.moveTo(30, y); c.lineTo(w + 30, y); c.stroke();
      c.fillText(String(Math.abs(d)), -w - 46, y + 5); c.fillText(String(Math.abs(d)), w + 46, y + 5);
    }
    c.setLineDash([]);
    c.restore();
    // Fixed aircraft symbol (wings + dot) in accent colour
    c.strokeStyle = '#ffd27a'; c.lineWidth = 3; c.lineCap = 'round';
    c.beginPath(); c.moveTo(cx - 60, cy); c.lineTo(cx - 22, cy); c.lineTo(cx - 12, cy + 10);
    c.moveTo(cx + 60, cy); c.lineTo(cx + 22, cy); c.lineTo(cx + 12, cy + 10); c.stroke();
    c.fillStyle = '#ffd27a'; c.beginPath(); c.arc(cx, cy, 3, 0, Math.PI * 2); c.fill();
    // Bank scale
    c.strokeStyle = 'rgba(235,242,248,0.45)'; c.lineWidth = 1.5;
    c.beginPath(); c.arc(cx, cy, 118, -Math.PI / 2 - Math.PI / 3, -Math.PI / 2 + Math.PI / 3); c.stroke();
    for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
      const r = a * Math.PI / 180, len = a % 30 === 0 ? 10 : 6;
      c.beginPath(); c.moveTo(cx + Math.sin(r) * 118, cy - Math.cos(r) * 118); c.lineTo(cx + Math.sin(r) * (118 + len), cy - Math.cos(r) * (118 + len)); c.stroke();
    }
    const br = -s.bank;
    c.fillStyle = '#ffd27a'; c.beginPath();
    c.moveTo(cx + Math.sin(br) * 114, cy - Math.cos(br) * 114);
    c.lineTo(cx + Math.sin(br - 0.04) * 104, cy - Math.cos(br - 0.04) * 104);
    c.lineTo(cx + Math.sin(br + 0.04) * 104, cy - Math.cos(br + 0.04) * 104); c.fill();
  }
}
