/**
 * Unified input: keyboard + mouse + gamepad → smoothed control axes in [-1, 1].
 * Keyboard axes are eased so a tap gives a gentle nudge and a hold a full deflection.
 */
export interface Controls {
  pitch: number;    // +1 = pull (nose up)
  roll: number;     // +1 = roll right
  yaw: number;      // +1 = nose right
  throttle: number; // 0..1
  flaps: number;    // 0..1 (target)
  brake: boolean;
}

export class Input {
  readonly controls: Controls = { pitch: 0, roll: 0, yaw: 0, throttle: 0, flaps: 0, brake: false };
  private keys = new Set<string>();
  private pressed = new Set<string>();       // edge-triggered
  private mouse = { x: 0, y: 0, active: false };
  private mouseSensitivity = 2.2;
  private target = { pitch: 0, roll: 0, yaw: 0 };
  private padButtonsPrev: boolean[] = [];
  private padPressed = new Set<number>();
  /** Fired for one-shot actions (camera toggle, reset, ...). */
  onAction: ((action: string) => void) | null = null;
  orbitDelta = { x: 0, y: 0, zoom: 0 };
  pointerLocked = false;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code); this.pressed.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 2 && !this.pointerLocked) canvas.requestPointerLock();
      if (e.button === 0) this.mouse.active = true;
    });
    window.addEventListener('mouseup', () => (this.mouse.active = false));
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
      if (!this.pointerLocked) this.mouse.x = this.mouse.y = 0;
    });
    window.addEventListener('mousemove', (e) => {
      if (this.pointerLocked) {
        this.mouse.x = Math.max(-1, Math.min(1, this.mouse.x + e.movementX * 0.0025 * this.mouseSensitivity));
        this.mouse.y = Math.max(-1, Math.min(1, this.mouse.y + e.movementY * 0.0025 * this.mouseSensitivity));
      } else if (this.mouse.active) {
        this.orbitDelta.x += e.movementX; this.orbitDelta.y += e.movementY;
      }
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.orbitDelta.zoom += e.deltaY;
      if (this.pointerLocked) this.controls.throttle = clamp01(this.controls.throttle - e.deltaY * 0.0008);
    }, { passive: false });
  }

  private pad(): Gamepad | null {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  update(dt: number) {
    const k = this.keys, c = this.controls;
    // Attack is quicker than release: inputs feel crisp, but letting go is gentle.
    const ease = 1 - Math.exp(-dt * 7);
    const decay = 1 - Math.exp(-dt * 12);
    // --- keyboard targets
    let tp = (k.has('ArrowUp') || k.has('KeyS') ? -1 : 0) + (k.has('ArrowDown') || k.has('KeyW') ? 1 : 0);
    let tr = (k.has('ArrowLeft') ? -1 : 0) + (k.has('ArrowRight') ? 1 : 0);
    let ty = (k.has('KeyQ') || k.has('KeyA') ? -1 : 0) + (k.has('KeyE') || k.has('KeyD') ? 1 : 0);
    // Pitch: arrow-down = pull. (ArrowUp pushes, like a real yoke.)
    if (k.has('ShiftLeft') || k.has('ShiftRight')) c.throttle = clamp01(c.throttle + dt * 0.5);
    if (k.has('ControlLeft') || k.has('ControlRight')) c.throttle = clamp01(c.throttle - dt * 0.5);
    c.brake = k.has('Space');
    // --- mouse (pointer lock)
    if (this.pointerLocked) {
      tp += this.mouse.y; tr += this.mouse.x;
      // auto-centre slowly so the stick returns when the hand stops
      this.mouse.x *= 1 - dt * 1.5; this.mouse.y *= 1 - dt * 1.5;
    }
    // --- gamepad
    const p = this.pad();
    if (p) {
      const dz = (v: number) => (Math.abs(v) < 0.12 ? 0 : Math.sign(v) * (Math.abs(v) - 0.12) / 0.88);
      const ax = dz(p.axes[0] ?? 0), ay = dz(p.axes[1] ?? 0), ry = dz(p.axes[3] ?? 0), rx = dz(p.axes[2] ?? 0);
      tr += ax; tp += ay; // stick forward (negative) = push = nose down
      const lt = p.buttons[6]?.value ?? 0, rt = p.buttons[7]?.value ?? 0;
      ty += rt - lt;
      if (Math.abs(ry) > 0) c.throttle = clamp01(c.throttle - ry * dt * 0.7);
      if (p.buttons[0]?.pressed) c.throttle = clamp01(c.throttle - dt * 0.5);
      if (p.buttons[1]?.pressed) c.throttle = clamp01(c.throttle + dt * 0.5);
      if (p.buttons[2]?.pressed) c.brake = true;
      this.orbitDelta.x += rx * 8; this.orbitDelta.y += ry * 8;
      const map: Record<number, string> = { 3: 'camera', 9: 'reset', 8: 'pause', 12: 'flapsUp', 13: 'flapsDown', 4: 'timeDown', 5: 'timeUp' };
      p.buttons.forEach((b, i) => {
        if (b.pressed && !this.padButtonsPrev[i] && map[i]) this.onAction?.(map[i]);
        this.padButtonsPrev[i] = b.pressed;
      });
    }
    this.target.pitch = clamp(tp, -1, 1); this.target.roll = clamp(tr, -1, 1); this.target.yaw = clamp(ty, -1, 1);
    // Smooth: attack faster than release for a crisp but forgiving feel.
    c.pitch += (this.target.pitch - c.pitch) * (Math.abs(this.target.pitch) > Math.abs(c.pitch) ? ease : decay);
    c.roll += (this.target.roll - c.roll) * (Math.abs(this.target.roll) > Math.abs(c.roll) ? ease : decay);
    c.yaw += (this.target.yaw - c.yaw) * (Math.abs(this.target.yaw) > Math.abs(c.yaw) ? ease : decay);
    // --- one-shot keys
    const keyMap: Record<string, string> = {
      KeyC: 'camera', KeyR: 'reset', KeyP: 'pause', Escape: 'pause', KeyF: 'flapsUp', KeyV: 'flapsDown',
      BracketLeft: 'timeDown', BracketRight: 'timeUp', KeyH: 'hud', KeyM: 'mute',
    };
    for (const code of this.pressed) if (keyMap[code]) this.onAction?.(keyMap[code]);
    this.pressed.clear();
  }

  consumeOrbit() { const d = { ...this.orbitDelta }; this.orbitDelta.x = this.orbitDelta.y = this.orbitDelta.zoom = 0; return d; }
  isDown(code: string) { return this.keys.has(code); }
}

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const clamp01 = (x: number) => clamp(x, 0, 1);
