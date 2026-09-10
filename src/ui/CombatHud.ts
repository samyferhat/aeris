import * as THREE from 'three';
import { Targeting } from '../combat/Targeting';
import { Loadout, STORES, GUN } from '../combat/Armament';
import { DamageTarget } from '../combat/Ordnance';

/**
 * The weapons overlay: a computed gun pipper, a lock box, and what is left on the
 * wings. Drawn on its own canvas over the flight HUD because all of it tracks points
 * in the world, which is the one thing the DOM instruments do not do.
 *
 * The brief for the rest of the HUD holds here too — the pilot needs to know what is
 * selected, how much of it is left, and where the rounds will go. Everything else is
 * decoration that gets in the way of looking out of the window.
 */

const _p = new THREE.Vector3();

export class CombatHud {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  visible = true;
  /** Seconds left on the launch warning. */
  private warnTime = 0;
  private warnFrom = new THREE.Vector3();
  private t = 0;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'combathud';
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(window.innerWidth * this.dpr));
    this.canvas.height = Math.max(1, Math.round(window.innerHeight * this.dpr));
    this.canvas.style.width = window.innerWidth + 'px';
    this.canvas.style.height = window.innerHeight + 'px';
  }

  /** An enemy has fired: put the warning up and remember where it came from. */
  launchWarning(from: THREE.Vector3) {
    this.warnTime = 4.5;
    this.warnFrom.copy(from);
  }

  private project(p: THREE.Vector3, cam: THREE.Camera, w: number, h: number) {
    _p.copy(p).project(cam);
    return { x: (_p.x * 0.5 + 0.5) * w, y: (1 - (_p.y * 0.5 + 0.5)) * h, front: _p.z < 1 };
  }

  draw(dt: number, cam: THREE.PerspectiveCamera, targeting: Targeting, loadout: Loadout,
       selected: string | null, playerPos: THREE.Vector3, armed: boolean) {
    this.t += dt;
    if (this.warnTime > 0) this.warnTime -= dt;
    const c = this.ctx;
    const W = this.canvas.width, H = this.canvas.height, s = this.dpr;
    c.clearRect(0, 0, W, H);
    if (!this.visible || !armed) return;
    c.save();
    c.scale(s, s);
    const w = W / s, h = H / s;
    c.lineWidth = 1.25;
    c.font = '500 12px ui-monospace, "SF Mono", Menlo, monospace';
    c.textBaseline = 'middle';
    const ink = 'rgba(150, 240, 190, 0.85)';
    const dim = 'rgba(150, 240, 190, 0.38)';

    // ---- gun pipper -------------------------------------------------------
    // Not a crosshair painted on the glass: the point where rounds fired now will be
    // when they get there, drop included. Aiming with it is aiming, not guessing.
    if (loadout.gunRounds > 0) {
      const pp = this.project(targeting.pipper, cam, w, h);
      if (pp.front) {
        c.strokeStyle = targeting.pipperValid ? ink : dim;
        c.beginPath();
        c.arc(pp.x, pp.y, 11, 0, Math.PI * 2);
        c.stroke();
        c.beginPath();
        for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
          c.moveTo(pp.x + Math.cos(a) * 11, pp.y + Math.sin(a) * 11);
          c.lineTo(pp.x + Math.cos(a) * 17, pp.y + Math.sin(a) * 17);
        }
        c.stroke();
        c.fillStyle = c.strokeStyle;
        c.fillRect(pp.x - 1, pp.y - 1, 2, 2);
      }
    }

    // ---- lock box ---------------------------------------------------------
    const tgt = targeting.locked;
    if (tgt && tgt.alive) {
      const tp = this.project(tgt.position, cam, w, h);
      if (tp.front) {
        // The box closes as the seeker settles: wide and open while it is searching,
        // tight and solid when the shot is on. One shape carries the whole state.
        const k = targeting.lockStrength;
        const r = 46 - 26 * k;
        const solid = k > 0.55;
        c.strokeStyle = solid ? 'rgba(255, 214, 120, 0.95)' : dim;
        c.lineWidth = solid ? 1.6 : 1.2;
        const corner = r * (solid ? 0.9 : 0.45);
        c.beginPath();
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as [number, number][]) {
          c.moveTo(tp.x + sx * r, tp.y + sy * r - sy * corner);
          c.lineTo(tp.x + sx * r, tp.y + sy * r);
          c.lineTo(tp.x + sx * r - sx * corner, tp.y + sy * r);
        }
        c.stroke();
        if (solid) {
          const km = targeting.range / 1000;
          c.fillStyle = 'rgba(255, 214, 120, 0.9)';
          c.fillText(km < 10 ? km.toFixed(1) : km.toFixed(0), tp.x + r + 8, tp.y - r + 6);
          if (targeting.inRange) {
            c.fillText('TIR', tp.x + r + 8, tp.y - r + 20);
          }
        }
      }
    }

    // ---- launch warning ----------------------------------------------------
    if (this.warnTime > 0) {
      const blink = 0.55 + 0.45 * Math.sin(this.t * 14);
      c.strokeStyle = `rgba(255, 70, 60, ${blink})`;
      c.lineWidth = 3;
      const m = 26;
      c.strokeRect(m, m, w - 2 * m, h - 2 * m);
      // Which way it came from, as a wedge on the frame.
      const dir = _p.copy(this.warnFrom).sub(playerPos);
      dir.applyQuaternion(cam.quaternion.clone().invert());
      const ang = Math.atan2(dir.x, -dir.z);
      const cx = w / 2, cy = h / 2, rad = Math.min(w, h) * 0.30;
      const ax = cx + Math.sin(ang) * rad, ay = cy - Math.cos(ang) * rad;
      c.fillStyle = `rgba(255, 70, 60, ${blink})`;
      c.beginPath();
      c.moveTo(ax + Math.sin(ang) * 16, ay - Math.cos(ang) * 16);
      c.lineTo(ax + Math.sin(ang + 2.4) * 11, ay - Math.cos(ang + 2.4) * 11);
      c.lineTo(ax + Math.sin(ang - 2.4) * 11, ay - Math.cos(ang - 2.4) * 11);
      c.closePath();
      c.fill();
      c.font = '600 15px ui-monospace, Menlo, monospace';
      c.textAlign = 'center';
      c.fillText('ПУСК', cx, m + 22);
      c.textAlign = 'left';
      c.font = '500 12px ui-monospace, Menlo, monospace';
    }

    // ---- what is left ------------------------------------------------------
    // Bottom right, two lines, no boxes. The selected weapon and how much of it there
    // is; the gun underneath. That is the whole armament panel.
    // Clear of the camera label and the time slider, which own the other corners.
    const x = w - 26, y = h - 104;
    c.textAlign = 'right';
    if (selected) {
      const sp = STORES[selected];
      const n = loadout.countOf(selected);
      c.fillStyle = n > 0 ? 'rgba(255,255,255,0.92)' : 'rgba(255,120,110,0.9)';
      c.font = '600 15px ui-monospace, Menlo, monospace';
      c.fillText(`${sp.name}  ×${n}`, x, y);
      c.font = '500 11px ui-monospace, Menlo, monospace';
      c.fillStyle = 'rgba(255,255,255,0.45)';
      c.fillText(sp.role.toUpperCase(), x, y + 16);
    } else {
      c.fillStyle = 'rgba(255,255,255,0.35)';
      c.fillText('AUCUNE ARME', x, y);
    }
    const gr = loadout.gunRounds;
    c.font = '600 14px ui-monospace, Menlo, monospace';
    c.fillStyle = gr > 0 ? 'rgba(255,255,255,0.72)' : 'rgba(255,120,110,0.85)';
    c.fillText(`${GUN.name}  ${gr}`, x, y + 38);
    // A thin depletion bar, because a count of rounds is abstract and a bar is not.
    const bw = 92, bh = 2;
    c.fillStyle = 'rgba(255,255,255,0.16)';
    c.fillRect(x - bw, y + 48, bw, bh);
    c.fillStyle = gr > 30 ? 'rgba(255,255,255,0.65)' : 'rgba(255,140,110,0.9)';
    c.fillRect(x - bw, y + 48, bw * (gr / GUN.rounds), bh);
    c.textAlign = 'left';
    c.restore();
  }

  /** Off-screen targets get nothing: this HUD never points at what you cannot see. */
  markHostiles(_list: DamageTarget[]) { /* reserved */ }

  toggle() { this.visible = !this.visible; this.canvas.style.display = this.visible ? '' : 'none'; }
}
