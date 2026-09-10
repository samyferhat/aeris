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
  /** Gun trigger, held. */
  fire: boolean;
  /** Speed brake out. On the ground it is the wheel brakes as well. */
  airbrake: boolean;
  /** Narrowed field of view, held. */
  zoom: boolean;
  /** Free look, in radians from the boresight: yaw then pitch. */
  lookYaw: number;
  lookPitch: number;
}

export class Input {
  readonly controls: Controls = { pitch: 0, roll: 0, yaw: 0, throttle: 0, flaps: 0, brake: false,
    fire: false, airbrake: false, zoom: false, lookYaw: 0, lookPitch: 0 };
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
  /** Trim asked for since the last read, in stick units. */
  trimDelta = 0;
  pointerLocked = false;
  /** Held state of the mouse trigger, kept separate from the keyboard. */
  private trigger = false;
  private looking = false;
  private look = { x: 0, y: 0 };
  /** True while a gamepad is connected, so the help panel can follow suit. */
  padPresent = false;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code); this.pressed.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab',
        'PageUp', 'PageDown', 'Backspace', 'F2', 'F11'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 2) { if (this.pointerLocked) this.looking = true; else canvas.requestPointerLock(); }
      if (e.button === 0) { if (this.pointerLocked) this.trigger = true; else this.mouse.active = true; }
      if (e.button === 1) { e.preventDefault(); this.onAction?.('lock'); }
    });
    window.addEventListener('mouseup', (e) => {
      this.mouse.active = false;
      if (e.button === 0) this.trigger = false;
      if (e.button === 2) this.looking = false;
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
      if (!this.pointerLocked) this.mouse.x = this.mouse.y = 0;
    });
    window.addEventListener('mousemove', (e) => {
      if (this.pointerLocked && this.looking) {
        // Head, not stick: the same movement now turns the pilot rather than the aircraft.
        this.look.x = clamp(this.look.x - e.movementX * 0.0026, -2.5, 2.5);
        this.look.y = clamp(this.look.y - e.movementY * 0.0022, -1.1, 1.1);
      } else if (this.pointerLocked) {
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
    // One lever: the board out, and the wheel brakes as well once the wheels are down,
    // which is how a fighter is actually slowed on the roll.
    c.brake = k.has('KeyB');
    c.airbrake = k.has('KeyB');
    // Space is the trigger on a combat aircraft; braking moves to B.
    c.fire = k.has('Space') || this.trigger;
    c.zoom = k.has('KeyZ');
    // Trim: a slow, held adjustment, the way a real trim wheel behaves.
    if (k.has('PageUp')) this.trimDelta += dt * 0.30;
    if (k.has('PageDown')) this.trimDelta -= dt * 0.30;
    // --- mouse (pointer lock)
    if (this.pointerLocked) {
      tp += this.mouse.y; tr += this.mouse.x;
      // auto-centre slowly so the stick returns when the hand stops
      this.mouse.x *= 1 - dt * 1.5; this.mouse.y *= 1 - dt * 1.5;
    }
    // --- gamepad
    const p = this.pad();
    this.padPresent = !!p;
    if (p) {
      const dz = (v: number) => (Math.abs(v) < 0.12 ? 0 : Math.sign(v) * (Math.abs(v) - 0.12) / 0.88);
      const ax = dz(p.axes[0] ?? 0), ay = dz(p.axes[1] ?? 0), ry = dz(p.axes[3] ?? 0), rx = dz(p.axes[2] ?? 0);
      tr += ax; tp += ay; // stick forward (negative) = push = nose down
      // A throttle wants a proportional axis, and once both sticks are spoken for the
      // triggers are the only pair left; the rudder moves to the shoulders, which on an
      // arcade flight model loses nothing.
      const lt = p.buttons[6]?.value ?? 0, rt = p.buttons[7]?.value ?? 0;
      if (rt > 0.02) c.throttle = clamp01(c.throttle + rt * dt * 0.8);
      if (lt > 0.02) c.throttle = clamp01(c.throttle - lt * dt * 0.8);
      ty += (p.buttons[5]?.pressed ? 1 : 0) - (p.buttons[4]?.pressed ? 1 : 0);
      if (p.buttons[2]?.pressed) { c.brake = true; c.airbrake = true; }
      if (p.buttons[0]?.pressed) c.fire = true;
      // Right stick is the hat: it moves the pilot's head, and orbits the free camera.
      this.look.x = clamp(this.look.x - rx * dt * 2.6, -2.5, 2.5);
      this.look.y = clamp(this.look.y - ry * dt * 1.6, -1.1, 1.1);
      if (Math.abs(rx) < 0.02 && Math.abs(ry) < 0.02) { this.look.x *= 1 - dt * 3; this.look.y *= 1 - dt * 3; }
      this.orbitDelta.x += rx * 8; this.orbitDelta.y += ry * 8;
      const map: Record<number, string> = { 3: 'camera', 9: 'reset', 8: 'help', 12: 'flapsUp', 13: 'flapsDown',
        14: 'weaponPrev', 15: 'weaponNext', 10: 'gear', 1: 'launch', 11: 'lock' };
      p.buttons.forEach((b, i) => {
        if (b.pressed && !this.padButtonsPrev[i] && map[i]) this.onAction?.(map[i]);
        this.padButtonsPrev[i] = b.pressed;
      });
    } else if (!this.looking) {
      // Let the head drift back to the boresight once it is released.
      this.look.x *= 1 - Math.min(1, dt * 2.2);
      this.look.y *= 1 - Math.min(1, dt * 2.2);
    }
    c.lookYaw = this.look.x;
    c.lookPitch = this.look.y;
    this.target.pitch = clamp(tp, -1, 1); this.target.roll = clamp(tr, -1, 1); this.target.yaw = clamp(ty, -1, 1);
    // Smooth: attack faster than release for a crisp but forgiving feel.
    c.pitch += (this.target.pitch - c.pitch) * (Math.abs(this.target.pitch) > Math.abs(c.pitch) ? ease : decay);
    c.roll += (this.target.roll - c.roll) * (Math.abs(this.target.roll) > Math.abs(c.roll) ? ease : decay);
    c.yaw += (this.target.yaw - c.yaw) * (Math.abs(this.target.yaw) > Math.abs(c.yaw) ? ease : decay);
    // --- one-shot keys
    const keyMap: Record<string, string> = {
      KeyC: 'camera', KeyR: 'reset', KeyP: 'pause', KeyF: 'flapsUp', KeyV: 'flapsDown',
      BracketLeft: 'timeDown', BracketRight: 'timeUp', KeyI: 'hud', KeyM: 'mute', KeyG: 'gear',
      Enter: 'launch', Tab: 'weaponNext', KeyT: 'lock', KeyX: 'flare',
      KeyH: 'help', Escape: 'help', F2: 'shot', F11: 'fullscreen', Backspace: 'trimReset',
    };
    for (const code of this.pressed) if (keyMap[code]) this.onAction?.(keyMap[code]);
    this.pressed.clear();
  }

  consumeOrbit() { const d = { ...this.orbitDelta }; this.orbitDelta.x = this.orbitDelta.y = this.orbitDelta.zoom = 0; return d; }
  isDown(code: string) { return this.keys.has(code); }
  /** Live gamepad button state, for the help panel's highlighting. */
  padDown(i: number) { const p = this.pad(); return !!p?.buttons[i]?.pressed; }
  padAxis(i: number) { const p = this.pad(); return p?.axes[i] ?? 0; }
  consumeTrim() { const t = this.trimDelta; this.trimDelta = 0; return t; }
}

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const clamp01 = (x: number) => clamp(x, 0, 1);
