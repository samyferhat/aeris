/** Bottom-centre time-of-day slider. Drives the whole lighting/atmosphere. */
export class TimeSlider {
  private input: HTMLInputElement;
  private clock: HTMLElement;
  onChange: ((hour: number) => void) | null = null;

  constructor(hour: number) {
    const el = document.createElement('div');
    el.className = 'timectl';
    el.innerHTML = `<span>heure</span><input type="range" min="0" max="24" step="0.05"><span class="clock"></span>`;
    document.body.appendChild(el);
    this.input = el.querySelector('input')!;
    this.clock = el.querySelector('.clock')!;
    this.input.value = String(hour);
    this.input.addEventListener('input', () => this.set(parseFloat(this.input.value)));
    this.input.addEventListener('keydown', (e) => e.preventDefault()); // keep keyboard for flying
    this.render(hour);
  }

  get value() { return parseFloat(this.input.value); }

  set(hour: number) {
    hour = ((hour % 24) + 24) % 24;
    this.input.value = hour.toFixed(2);
    this.render(hour);
    this.onChange?.(hour);
  }

  private render(h: number) {
    const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    this.clock.textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
}
