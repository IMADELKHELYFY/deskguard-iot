import { Component, computed, input } from '@angular/core';

const PATHS = {
  ruler: 'M3 7h18v10H3z M7 7v4 M11 7v3 M15 7v4 M19 7v3',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4',
  moon: 'M12 3a7 7 0 1 0 9 9 9 9 0 1 1-9-9z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5l3 3',
  chart: 'M4 19h16 M4 15l4-6 4 3 4-7 4 4',
  settings: 'M4 6h10 M18 6h2 M16 4v4 M4 12h4 M12 12h8 M10 10v4 M4 18h11 M19 18h1 M17 16v4',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 11v5 M12 8h.01',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M3.6 9h16.8 M3.6 15h16.8 M12 3a15 15 0 0 1 0 18 M12 3a15 15 0 0 0 0 18',
  desk: 'M3 5h18v11H3z M8 20h8 M12 16v4',
  bell: 'M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3H4a4 4 0 0 0 2-3v-3a7 7 0 0 1 4-6 M9 17v1a3 3 0 0 0 6 0v-1',
  gauge: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 12l3-3 M7 12h.01 M12 7h.01',
  history: 'M12 8v4l2 2 M3.05 11a9 9 0 1 1 .5 4 M3 20v-5h5',
  alert: 'M12 9v4 M12 17h.01 M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  send: 'M10 14L21 3 M21 3l-6.5 18a.55.55 0 0 1-1 0L10 14l-7-3.5a.55.55 0 0 1 0-1L21 3',
  check: 'M5 12l5 5L20 7',
  left: 'M15 6l-6 6 6 6',
  right: 'M9 6l6 6-6 6',
};

export type IconName = keyof typeof PATHS;

@Component({
  selector: 'app-icon',
  template: `<svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="d()" /></svg>`,
  host: { class: 'icon' },
})
export class Icon {
  readonly name = input.required<IconName>();
  protected readonly d = computed(() => PATHS[this.name()]);
}
