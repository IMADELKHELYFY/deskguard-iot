import { Component, computed, inject } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Icon } from '../icon';
import { TelemetryService } from '../telemetry.service';
import { UiService, hhmm } from '../ui.service';

const CHART = { w: 600, h: 200, pad: 24 };
const RING = 2 * Math.PI * 26; // circonférence de l'anneau « temps assis » (r = 26)
const MAX_GAP_MS = 3 * 60_000;

@Component({
  selector: 'app-dashboard',
  imports: [DecimalPipe, Icon],
  templateUrl: './dashboard.html',
})
export class Dashboard {
  protected readonly tm = inject(TelemetryService);
  protected readonly t = inject(UiService).t;
  protected readonly chartBox = CHART;

  protected readonly reasonText = computed(() => {
    const l = this.tm.live();
    const r = this.t().reason;
    if (!l) return '';
    switch (l.reason) {
      case 'break':
        return r.break(l.sitMin);
      case 'light':
        return r.light(l.imbalance);
      case 'proximity':
        return r.proximity;
      default:
        return r.ok;
    }
  });

  protected readonly sitPct = computed(() => {
    const l = this.tm.live();
    return l ? Math.min(100, (l.sitMin / this.tm.config().pauseMin) * 100) : 0;
  });

  protected readonly ring = RING;
  /** Remplissage de la jauge d'écart lumineux, en %. */
  protected readonly lightPct = computed(() => {
    const l = this.tm.live();
    return l && l.imbalance >= 0 ? Math.min(100, l.imbalance) : 0;
  });

  /** Couleur d'accent de chaque tuile, d'après les seuils de la configuration. */
  protected readonly tileState = computed(() => {
    const l = this.tm.live();
    const c = this.tm.config();
    if (!l || !this.tm.online()) return { distance: '', presence: '', light: '', session: '' };
    const sit = this.sitPct();
    return {
      distance: l.distance <= 0 ? '' : l.distance < c.distMin ? 'red' : 'green',
      presence: l.present ? 'green' : '',
      light: l.imbalance < 0 ? '' : l.imbalance > c.imbalancePct ? 'orange' : 'green',
      session: sit >= 100 ? 'orange' : sit >= 80 ? 'warn' : 'green',
    };
  });

  protected readonly chart = computed(() => {
    const rows = this.tm.history().filter((r) => typeof r.ts === 'number');
    if (rows.length < 2) return null;
    const { w, h, pad } = CHART;
    const t0 = rows[0].ts;
    const t1 = Math.max(rows[rows.length - 1].ts, t0 + 60_000);
    const maxD = Math.max(150, ...rows.map((r) => r.distance));
    const x = (t: number) => pad + ((t - t0) / (t1 - t0)) * (w - 2 * pad);
    const y = (d: number) => h - pad - (d / maxD) * (h - 2 * pad);

    // Tracés continus ; on lève le crayon si l'ESP32 s'est tu plus de 3 min ou si la mesure est hors portée
    const runs: [number, number][][] = [];
    let run: [number, number][] = [];
    let prevTs = t0;
    for (const r of rows) {
      if (r.ts - prevTs > MAX_GAP_MS && run.length) { runs.push(run); run = []; }
      prevTs = r.ts;
      if (r.distance > 0) run.push([x(r.ts), y(r.distance)]);
      else if (run.length) { runs.push(run); run = []; }
    }
    if (run.length) runs.push(run);
    const f = (n: number) => n.toFixed(1);
    const base = h - pad;
    const path = runs.map((pts) => pts.map(([px, py], i) => `${i ? 'L' : 'M'}${f(px)},${f(py)}`).join('')).join('');
    const area = runs
      .filter((pts) => pts.length > 1)
      .map((pts) => `M${f(pts[0][0])},${base}` + pts.map(([px, py]) => `L${f(px)},${f(py)}`).join('') + `L${f(pts[pts.length - 1][0])},${base}Z`)
      .join('');
    const last = runs.length ? runs[runs.length - 1].at(-1)! : null;
    const grid = [0.25, 0.5, 0.75, 1].map((k) => ({ y: y(maxD * k), label: Math.round(maxD * k) }));

    // Points d'alerte : segments de longueur nulle à bout rond, insensibles à l'étirement du SVG
    const dots = (state: string) =>
      rows
        .filter((r) => r.state === state && r.distance > 0)
        .map((r) => `M${x(r.ts).toFixed(1)},${y(r.distance).toFixed(1)}h0`)
        .join('');

    return {
      path,
      area,
      grid,
      last: last ? { x: (last[0] / w) * 100, y: (last[1] / h) * 100 } : null,
      thresholdPct: (y(this.tm.config().distMin) / h) * 100,
      orangeDots: dots('orange'),
      redDots: dots('red'),
      thresholdY: y(this.tm.config().distMin),
      maxD: Math.round(maxD),
      start: hhmm(t0),
      end: hhmm(t1),
    };
  });
}
