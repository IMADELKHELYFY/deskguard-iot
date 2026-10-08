import { LedState, Measure } from '../telemetry.service';

export type Verdict = 'good' | 'watch' | 'danger';

export interface Session {
  start: number;
  end: number;
  ongoing: boolean;
  ms: Record<LedState, number>;                          // temps passé dans chaque état
  reasons: { proximity: number; break: number; light: number };
  verdict: Verdict;
}

export interface Segment {
  start: number;
  end: number;
  state: LedState;
}

export interface DayAnalysis {
  sessions: Session[];
  segments: Segment[];
  total: number;
  longest: number;
  ms: Record<LedState, number>;
}

/** Au-delà de cet écart entre deux enregistrements, on considère une coupure (ESP32 éteint, absence). */
const MAX_STEP_MS = 3 * 60_000;

/** Danger si > 10 % du temps trop près ; à surveiller si > 25 % du temps en alerte. */
export function verdictOf(ms: Record<LedState, number>): Verdict {
  const total = ms.green + ms.orange + ms.red;
  if (!total) return 'good';
  if (ms.red / total > 0.1) return 'danger';
  if ((ms.orange + ms.red) / total > 0.25) return 'watch';
  return 'good';
}

/**
 * Découpe une journée d'historique en sessions devant l'écran.
 * Chaque enregistrement compte jusqu'au suivant (plafonné à 3 min) dans l'état LED qu'il porte.
 */
export function analyzeDay(rows: Measure[], nowTs: number, isToday: boolean): DayAnalysis {
  const sorted = rows.filter((r) => typeof r.ts === 'number').sort((a, b) => a.ts - b.ts);
  const sessions: Session[] = [];
  const segments: Segment[] = [];
  let cur: Session | null = null;

  const close = () => {
    if (!cur) return;
    cur.verdict = verdictOf(cur.ms);
    sessions.push(cur);
    cur = null;
  };

  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    const next = sorted[i + 1];
    const seated = r.seated ?? r.present;
    const stepEnd = next
      ? Math.min(next.ts, r.ts + MAX_STEP_MS)
      : Math.min(isToday ? nowTs : r.ts + 60_000, r.ts + MAX_STEP_MS);

    if (!seated) {
      close();
      continue;
    }
    if (cur && r.ts > (cur as Session).end) close(); // trou dans les données
    if (!cur) {
      cur = {
        start: r.ts,
        end: r.ts,
        ongoing: false,
        ms: { green: 0, orange: 0, red: 0 },
        reasons: { proximity: 0, break: 0, light: 0 },
        verdict: 'good',
      };
    }
    const session: Session = cur;
    const dt = Math.max(0, stepEnd - r.ts);
    session.ms[r.state] += dt;
    if (r.reason !== 'ok') session.reasons[r.reason] += dt;
    session.end = stepEnd;

    const last = segments[segments.length - 1];
    if (last && last.state === r.state && last.end === r.ts) last.end = stepEnd;
    else segments.push({ start: r.ts, end: stepEnd, state: r.state });
  }
  if (cur) (cur as Session).ongoing = isToday && nowTs - (cur as Session).end < MAX_STEP_MS;
  close();

  const ms = { green: 0, orange: 0, red: 0 };
  for (const s of sessions) {
    ms.green += s.ms.green;
    ms.orange += s.ms.orange;
    ms.red += s.ms.red;
  }
  const lengths = sessions.map((s) => s.end - s.start);
  return {
    sessions,
    segments,
    total: lengths.reduce((a, b) => a + b, 0),
    longest: Math.max(0, ...lengths),
    ms,
  };
}
