import { Component, computed, effect, inject, signal } from '@angular/core';
import { LowerCasePipe } from '@angular/common';
import { Icon } from '../icon';
import { Measure, TelemetryService } from '../telemetry.service';
import { UiService, duration, hhmm } from '../ui.service';
import { analyzeDay } from './sessions';

const DAY_MS = 86_400_000;

@Component({
  selector: 'app-history',
  imports: [Icon, LowerCasePipe],
  templateUrl: './history.html',
})
export class History {
  protected readonly tm = inject(TelemetryService);
  protected readonly t = inject(UiService).t;
  protected readonly hhmm = hhmm;
  protected readonly duration = duration;

  protected readonly day = signal(this.tm.dayStart(Date.now()));
  protected readonly rows = signal<Measure[]>([]);
  protected readonly isToday = computed(() => this.day() === this.tm.dayStart(this.tm.now()));

  protected readonly analysis = computed(() => analyzeDay(this.rows(), this.tm.serverNow(), this.isToday()));

  /** Fenêtre de la frise : de l'heure pleine avant la 1re session à l'heure pleine après la dernière. */
  protected readonly timeline = computed(() => {
    const { sessions, segments } = this.analysis();
    if (!sessions.length) return null;
    const hour = 3_600_000;
    const from = Math.floor(sessions[0].start / hour) * hour;
    const to = Math.max(Math.ceil(sessions[sessions.length - 1].end / hour) * hour, from + hour);
    const pct = (ts: number) => ((ts - from) / (to - from)) * 100;
    const hours: { left: number; label: string }[] = [];
    const step = to - from > 8 * hour ? 2 * hour : hour;
    for (let h = from; h <= to; h += step) hours.push({ left: pct(h), label: hhmm(h) });
    return {
      hours,
      bars: segments.map((s) => ({ left: pct(s.start), width: Math.max(0.3, pct(s.end) - pct(s.start)), state: s.state })),
    };
  });

  protected readonly sessionsDesc = computed(() =>
    this.analysis()
      .sessions.map((s, i) => ({ ...s, n: i + 1, length: s.end - s.start }))
      .reverse(),
  );

  protected readonly dateValue = computed(() => {
    const d = new Date(this.day());
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });

  constructor() {
    effect((onCleanup) => {
      this.rows.set([]);
      const unsubscribe = this.tm.watchDay(this.day(), (rows) => this.rows.set(rows));
      onCleanup(unsubscribe);
    });
  }

  protected shiftDay(delta: number): void {
    // On vise midi du jour cible puis on revient à minuit : robuste aux changements d'heure
    this.day.update((d) => this.tm.dayStart(d + delta * DAY_MS + DAY_MS / 2));
  }

  protected pickDate(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (!value) return;
    const [y, m, d] = value.split('-').map(Number);
    this.day.set(new Date(y, m - 1, d).getTime());
  }

  protected pct(part: number, total: number): number {
    return total ? Math.round((part / total) * 100) : 0;
  }
}
