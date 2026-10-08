import { Injectable, computed, effect, signal } from '@angular/core';
import { I18N, Lang } from './i18n';

function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* stockage indisponible (navigation privée) */
  }
}

/** Langue et thème, partagés par toutes les pages. */
@Injectable({ providedIn: 'root' })
export class UiService {
  readonly lang = signal<Lang>(readPref('lang') === 'en' ? 'en' : 'fr');
  readonly theme = signal<'light' | 'dark'>(
    (readPref('theme') as 'light' | 'dark' | null) ??
      (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  );
  readonly t = computed(() => I18N[this.lang()]);

  constructor() {
    effect(() => {
      document.documentElement.dataset['theme'] = this.theme();
      writePref('theme', this.theme());
    });
    effect(() => {
      document.documentElement.lang = this.lang();
      writePref('lang', this.lang());
    });
  }

  toggleLang(): void {
    this.lang.update((l) => (l === 'fr' ? 'en' : 'fr'));
  }

  toggleTheme(): void {
    this.theme.update((t) => (t === 'dark' ? 'light' : 'dark'));
  }
}

export function hhmm(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** 95 min -> "1 h 35", 12 min -> "12 min" */
export function duration(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}
