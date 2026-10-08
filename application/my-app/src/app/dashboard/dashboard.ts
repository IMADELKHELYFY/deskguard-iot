import { Component, computed, inject } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Icon } from '../icon';
import { TelemetryService } from '../telemetry.service';
import { UiService, hhmm } from '../ui.service';

const CHART = { w: 600, h: 180, pad: 28 };

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

  protected readonly chart = computed(() => {
    const rows = this.tm.history().filter((r) => typeof r.ts === 'number');
    if (rows.length < 2) return null;
    const { w, h, pad } = CHART;
    const t0 = rows[0].ts;
    const t1 = Math.max(rows[rows.length - 1].ts, t0 + 60_000);
    const maxD = Math.max(150, ...rows.map((r) => r.distance));
    const x = (t: number) => pad + ((t - t0) / (t1 - t0)) * (w - 2 * pad);
    const y = (d: number) => h - pad - (d / maxD) * (h - 2 * pad);

    let path = '';
    let penDown = false;
    for (const r of rows) {
      if (r.distance > 0) {
        path += `${penDown ? 'L' : 'M'}${x(r.ts).toFixed(1)},${y(r.distance).toFixed(1)}`;
        penDown = true;
      } else {
        penDown = false;
      }
    }
    // Points d'alerte : segments de longueur nulle à bout rond, insensibles à l'étirement du SVG
    const dots = (state: string) =>
      rows
        .filter((r) => r.state === state && r.distance > 0)
        .map((r) => `M${x(r.ts).toFixed(1)},${y(r.distance).toFixed(1)}h0`)
        .join('');

    return {
      path,
      orangeDots: dots('orange'),
      redDots: dots('red'),
      thresholdY: y(this.tm.config().distMin),
      maxD: Math.round(maxD),
      start: hhmm(t0),
      end: hhmm(t1),
    };
  });
}
