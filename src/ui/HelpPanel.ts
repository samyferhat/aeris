import { Input } from '../core/Input';

/**
 * The commands panel.
 *
 * It is the first thing anyone sees, so it is built to the same standard as the rest:
 * frosted glass over the live scene rather than a black modal, the keycaps drawn as
 * keycaps, and every row lighting up under the key that actually triggers it. That last
 * detail is the one that earns its keep — the panel doubles as a test rig, and a pilot
 * can check what a control does without closing it.
 *
 * The bindings here are not a copy of the input map. They carry the same key codes the
 * input reads, so a row cannot describe a key the game does not listen to.
 */

type Cap = { cap: string; code?: string; wide?: boolean };
type PadCap = { cap: string; button?: number; axis?: number; face?: 'a' | 'b' | 'x' | 'y'; shape?: 'round' | 'stick' | 'pill' };

interface Binding {
  label: string;
  desc: string;
  keys: Cap[];
  pad: PadCap[];
  /** Shown with a badge, and only meaningful on the fighter. */
  mig?: boolean;
  /** No gamepad binding exists; say so rather than leave a blank. */
  padNone?: boolean;
}

interface Section { title: string; rows: Binding[]; mig?: boolean }

const K = (cap: string, code?: string, wide = false): Cap => ({ cap, code, wide });
const P = (cap: string, button?: number, face?: PadCap['face'], shape: PadCap['shape'] = 'round'): PadCap =>
  ({ cap, button, face, shape });
const STICK = (cap: string, axis: number): PadCap => ({ cap, axis, shape: 'stick' });

const SECTIONS: Section[] = [
  {
    title: 'Pilotage',
    rows: [
      {
        label: 'Tangage · Roulis', desc: 'Souris après un clic droit, ou les flèches',
        keys: [K('↑', 'ArrowUp'), K('↓', 'ArrowDown'), K('←', 'ArrowLeft'), K('→', 'ArrowRight')],
        pad: [STICK('Stick G', 0)],
      },
      {
        label: 'Lacet · palonnier', desc: 'Aligne le nez sur la piste en finale',
        keys: [K('Q', 'KeyQ'), K('E', 'KeyE')],
        pad: [P('LB', 4, undefined, 'pill'), P('RB', 5, undefined, 'pill')],
      },
      {
        label: 'Gaz', desc: 'Maintenir pour monter ou réduire la manette',
        keys: [K('Maj', 'ShiftLeft', true), K('Ctrl', 'ControlLeft', true)],
        pad: [P('LT', 6, undefined, 'pill'), P('RT', 7, undefined, 'pill')],
      },
      {
        label: 'Post-combustion', desc: 'Dernier cran de manette — poussée maximale, forte consommation',
        keys: [K('Maj', 'ShiftLeft', true)],
        pad: [P('RT', 7, undefined, 'pill')], mig: true,
      },
      {
        label: 'Aérofreins', desc: 'Au sol, sert aussi de frein de roue',
        keys: [K('B', 'KeyB')],
        pad: [P('X', 2, 'x')],
      },
      {
        label: 'Volets', desc: 'Trois crans. Sortis en finale, rentrés au décollage',
        keys: [K('V', 'KeyV'), K('F', 'KeyF')],
        pad: [P('▲', 12), P('▼', 13)],
      },
      {
        label: 'Train d’atterrissage', desc: 'Sortir sous 250 nœuds',
        keys: [K('G', 'KeyG')],
        pad: [P('L3', 10, undefined, 'pill')], mig: true,
      },
      {
        label: 'Trim', desc: 'Décale le neutre du manche · Retour arrière remet à zéro',
        keys: [K('Pg↑', 'PageUp', true), K('Pg↓', 'PageDown', true)],
        pad: [], padNone: true,
      },
    ],
  },
  {
    title: 'Caméra',
    rows: [
      {
        label: 'Cockpit · poursuite · libre', desc: 'Cycle entre les trois vues',
        keys: [K('C', 'KeyC')],
        pad: [P('Y', 3, 'y')],
      },
      {
        label: 'Regard libre', desc: 'Clic droit maintenu et souris · revient seul au relâcher',
        keys: [K('Clic droit', undefined, true)],
        pad: [STICK('Stick D', 2)],
      },
      {
        label: 'Zoom', desc: 'Rétrécit le champ pour identifier au loin',
        keys: [K('Z', 'KeyZ')],
        pad: [], padNone: true,
      },
    ],
  },
  {
    title: 'Armement',
    mig: true,
    rows: [
      {
        label: 'Sélection de l’arme', desc: 'Passe d’un type d’emport au suivant',
        keys: [K('Tab', 'Tab', true)],
        pad: [P('◀', 14), P('▶', 15)],
      },
      {
        label: 'Tir canon', desc: 'GSh-30-1 · 150 obus, six secondes de détente en tout',
        keys: [K('Espace', 'Space', true)],
        pad: [P('A', 0, 'a')],
      },
      {
        label: 'Tir missile · roquettes · bombes', desc: 'Largue l’arme sélectionnée, un pylône à la fois',
        keys: [K('Entrée', 'Enter', true)],
        pad: [P('B', 1, 'b')],
      },
      {
        label: 'Verrouillage cible', desc: 'Le cadre se referme, le grondement infrarouge monte',
        keys: [K('T', 'KeyT')],
        pad: [P('R3', 11, undefined, 'pill')],
      },
      {
        label: 'Cible suivante', desc: 'Appuis successifs : parcourt ce qui est devant le nez',
        keys: [K('T', 'KeyT')],
        pad: [P('R3', 11, undefined, 'pill')],
      },
      {
        label: 'Leurres', desc: 'BVP-30-26 · trente cartouches, la seule réponse à une alerte de départ',
        keys: [K('X', 'KeyX')],
        pad: [], padNone: true,
      },
    ],
  },
  {
    title: 'Général',
    rows: [
      { label: 'Aide', desc: 'Ce panneau', keys: [K('H', 'KeyH'), K('Échap', 'Escape', true)], pad: [P('Back', 8, undefined, 'pill')] },
      { label: 'Pause', desc: 'Fige le vol sans ouvrir l’aide', keys: [K('P', 'KeyP')], pad: [], padNone: true },
      { label: 'Heure du jour', desc: 'Ou le curseur en bas de l’écran', keys: [K('[', 'BracketLeft'), K(']', 'BracketRight')], pad: [], padNone: true },
      { label: 'Réinitialiser la position', desc: 'Repose l’appareil au seuil de piste', keys: [K('R', 'KeyR')], pad: [P('Start', 9, undefined, 'pill')] },
      { label: 'Capture d’écran', desc: 'Enregistre l’image telle qu’elle est rendue', keys: [K('F2', 'F2', true)], pad: [], padNone: true },
      { label: 'Plein écran', desc: '', keys: [K('F11', 'F11', true)], pad: [], padNone: true },
      { label: 'Masquer l’interface', desc: 'Pour voler, ou photographier, sans instruments', keys: [K('I', 'KeyI')], pad: [], padNone: true },
      { label: 'Couper le son', desc: '', keys: [K('M', 'KeyM')], pad: [], padNone: true },
    ],
  },
];

const TIP = 'Conseil — sortez le train sous 250 nœuds, arrondissez à 3 mètres.';
const STORAGE = 'aeris.helpSeen';

export class HelpPanel {
  private root: HTMLElement;
  private panel: HTMLElement;
  private hint: HTMLElement;
  visible = false;
  /** 'keyboard' | 'pad', or null while it follows whatever is plugged in. */
  private mode: 'keyboard' | 'pad' | null = null;
  private shownMode: 'keyboard' | 'pad' = 'keyboard';
  private hintLeft = 15;
  private caps: { el: HTMLElement; code?: string; button?: number; axis?: number }[] = [];
  /** Fires whenever the panel opens or closes, so the world can pause. */
  onToggle: ((open: boolean) => void) | null = null;

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'help';
    this.root.innerHTML = `
      <div class="help-panel">
        <header class="help-head">
          <div class="help-title">A E R I S</div>
          <div class="help-sub">Commandes</div>
          <div class="help-tabs">
            <button class="help-tab" data-mode="keyboard">Clavier</button>
            <button class="help-tab" data-mode="pad">Manette</button>
          </div>
        </header>
        <div class="help-cols"></div>
        <footer class="help-foot">
          <span class="help-tip">${TIP}</span>
          <span class="help-close">H ou Échap pour fermer</span>
        </footer>
      </div>`;
    document.body.appendChild(this.root);
    this.panel = this.root.querySelector('.help-panel') as HTMLElement;
    this.build();

    this.hint = document.createElement('div');
    this.hint.className = 'help-hint';
    this.hint.textContent = 'H pour l’aide';
    document.body.appendChild(this.hint);

    this.root.querySelectorAll<HTMLElement>('.help-tab').forEach((b) => {
      b.addEventListener('click', () => { this.mode = b.dataset.mode as 'keyboard' | 'pad'; this.render(); });
    });
    // Clicking the glass closes it, the way a modal should.
    this.root.addEventListener('pointerdown', (e) => { if (e.target === this.root) this.close(); });
  }

  private build() {
    const cols = this.root.querySelector('.help-cols') as HTMLElement;
    let order = 0;
    for (const sec of SECTIONS) {
      const col = document.createElement('section');
      col.className = 'help-col';
      const h = document.createElement('h2');
      h.textContent = sec.title;
      if (sec.mig) h.innerHTML += '<i class="help-badge">MiG-29</i>';
      h.style.setProperty('--i', String(order++));
      col.appendChild(h);
      for (const row of sec.rows) {
        const el = document.createElement('div');
        el.className = 'help-row';
        el.style.setProperty('--i', String(order++));
        const keys = document.createElement('div');
        keys.className = 'help-keys';
        const text = document.createElement('div');
        text.className = 'help-text';
        text.innerHTML = `<span class="help-label">${row.label}${row.mig && !sec.mig ? '<i class="help-badge">MiG</i>' : ''}</span>`
          + (row.desc ? `<span class="help-desc">${row.desc}</span>` : '');
        el.appendChild(keys);
        el.appendChild(text);
        col.appendChild(el);
        (el as HTMLElement & { _row?: Binding })._row = row;
      }
      cols.appendChild(col);
    }
    this.render();
  }

  /** Redraw the keycaps for the current input device. */
  private render() {
    const pad = this.mode ?? this.shownMode;
    this.root.querySelectorAll<HTMLElement>('.help-tab').forEach((b) => {
      b.classList.toggle('on', b.dataset.mode === pad);
    });
    this.caps = [];
    this.root.querySelectorAll<HTMLElement>('.help-row').forEach((el) => {
      const row = (el as HTMLElement & { _row?: Binding })._row;
      if (!row) return;
      const box = el.querySelector('.help-keys') as HTMLElement;
      box.innerHTML = '';
      if (pad === 'pad') {
        if (row.padNone) {
          const s = document.createElement('span');
          s.className = 'help-nopad';
          s.textContent = '—';
          box.appendChild(s);
        }
        for (const p of row.pad) {
          const cap = document.createElement('span');
          cap.className = `help-cap pad ${p.shape ?? 'round'}${p.face ? ' face-' + p.face : ''}`;
          cap.textContent = p.cap;
          box.appendChild(cap);
          this.caps.push({ el: cap, button: p.button, axis: p.axis });
        }
      } else {
        for (const k of row.keys) {
          const cap = document.createElement('span');
          cap.className = 'help-cap' + (k.wide ? ' wide' : '');
          cap.textContent = k.cap;
          box.appendChild(cap);
          this.caps.push({ el: cap, code: k.code });
        }
      }
    });
  }

  /** Show it once, on the very first run, and never again. */
  maybeShowFirstRun() {
    let seen = false;
    try { seen = localStorage.getItem(STORAGE) === '1'; } catch { seen = false; }
    if (seen) return false;
    try { localStorage.setItem(STORAGE, '1'); } catch { /* private window */ }
    this.open();
    return true;
  }

  open() {
    if (this.visible) return;
    this.visible = true;
    this.root.classList.add('on');
    this.hintLeft = 0;
    this.hint.classList.add('gone');
    this.onToggle?.(true);
  }

  close() {
    if (!this.visible) return;
    this.visible = false;
    this.root.classList.remove('on');
    this.onToggle?.(false);
  }

  toggle() { this.visible ? this.close() : this.open(); }

  /**
   * Live feedback. The panel is only worth updating while it is up, but the hint at
   * the bottom of the screen has its own fifteen seconds to run down.
   */
  update(dt: number, input: Input) {
    if (this.hintLeft > 0) {
      this.hintLeft -= dt;
      if (this.hintLeft <= 0) this.hint.classList.add('gone');
    }
    if (!this.visible) return;
    // Follow the hardware unless the pilot has picked a tab by hand.
    const want: 'keyboard' | 'pad' = input.padPresent ? 'pad' : 'keyboard';
    if (want !== this.shownMode) { this.shownMode = want; if (!this.mode) this.render(); }
    for (const c of this.caps) {
      let down = false;
      if (c.code) down = input.isDown(c.code)
        || (c.code === 'ShiftLeft' && input.isDown('ShiftRight'))
        || (c.code === 'ControlLeft' && input.isDown('ControlRight'));
      else if (c.button !== undefined) down = input.padDown(c.button);
      else if (c.axis !== undefined) {
        down = Math.abs(input.padAxis(c.axis)) > 0.18 || Math.abs(input.padAxis(c.axis + 1)) > 0.18;
      }
      c.el.classList.toggle('down', down);
    }
  }

  /** Start the fifteen-second hint once the flight actually begins. */
  startHint() {
    if (this.visible) return;
    this.hintLeft = 15;
    this.hint.classList.remove('gone');
  }
}
