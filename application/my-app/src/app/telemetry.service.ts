import { Injectable, OnDestroy, computed, signal } from '@angular/core';
import { Unsubscribe, endAt, onValue, orderByChild, query, ref, remove, set, startAt } from 'firebase/database';
import { DEVICE_ID, db } from './firebase';

export type LedState = 'green' | 'orange' | 'red';
export type Reason = 'ok' | 'proximity' | 'break' | 'light';

export interface Measure {
  ts: number;
  device: string;
  distance: number;   // cm, -1 si hors portée
  motion: boolean;
  present: boolean;   // présence instantanée (PIR ou distance < 120 cm)
  seated?: boolean;   // présence lissée : faux après 2 min d'absence
  lux1: number;       // côté écran, -1 si capteur absent
  lux2: number;       // côté pièce
  imbalance: number;  // %, -1 si non calculable
  sitMin: number;
  state: LedState;
  reason: Reason;
  alerts?: { proximity: boolean; light: boolean; break: boolean };
}

export interface DeviceConfig {
  distMin: number;
  proxDelayS: number;
  imbalancePct: number;
  luxCal: number;
  lightDelayS: number;
  pauseMin: number;
  sendPeriodS: number;
  telegramOn: boolean;
}

/** devices/<id>/telegram : écrit par l'app (demande) puis par l'ESP32 (résultat). */
export interface TelegramLink {
  phoneHash: string;   // SHA-256 des 9 derniers chiffres
  phoneLast2: string;
  code: string;        // code transmis au bot via /start <code>
  status: 'pending' | 'verified' | 'failed';
  chatId?: number;
}

// Valeurs du cahier des charges (TD1)
export const DEFAULT_CONFIG: DeviceConfig = {
  distMin: 45,
  proxDelayS: 10,
  imbalancePct: 50,
  luxCal: 1,
  lightDelayS: 10,
  pauseMin: 50,
  sendPeriodS: 5,
  telegramOn: true,
};

/** 9 derniers chiffres : "+33 6 12 34 56 78" et "06 12 34 56 78" donnent "612345678". */
export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '').slice(-9);
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

@Injectable({ providedIn: 'root' })
export class TelemetryService implements OnDestroy {
  readonly deviceId = DEVICE_ID;
  readonly live = signal<Measure | null>(null);
  readonly history = signal<Measure[]>([]);
  readonly config = signal<DeviceConfig>(DEFAULT_CONFIG);
  readonly telegram = signal<TelegramLink | null>(null);
  readonly telegramBot = signal<string | null>(null);
  readonly connected = signal(false);

  private readonly serverOffset = signal(0);
  readonly now = signal(Date.now());

  /** Secondes depuis la dernière mesure, à l'heure du serveur Firebase. */
  readonly ageSec = computed(() => {
    const l = this.live();
    return l ? Math.max(0, Math.round((this.serverNow() - l.ts) / 1000)) : null;
  });
  /** Hors ligne si aucune mesure depuis 3 périodes d'envoi (min. 15 s). */
  readonly online = computed(() => {
    const age = this.ageSec();
    return age !== null && age <= Math.max(15, 3 * this.config().sendPeriodS);
  });

  private readonly base = `devices/${DEVICE_ID}`;
  private readonly subs: Unsubscribe[] = [];
  private readonly timer = setInterval(() => this.now.set(Date.now()), 1000);

  constructor() {
    this.subs.push(
      onValue(ref(db, `${this.base}/live`), (s) => this.live.set(s.val())),
      this.watchDay(this.dayStart(Date.now()), (rows) => this.history.set(rows)),
      onValue(ref(db, `${this.base}/config`), (s) => this.config.set({ ...DEFAULT_CONFIG, ...(s.val() ?? {}) })),
      onValue(ref(db, `${this.base}/telegram`), (s) => this.telegram.set(s.val())),
      onValue(ref(db, `${this.base}/telegramBot`), (s) => this.telegramBot.set(s.val())),
      onValue(ref(db, '.info/connected'), (s) => this.connected.set(s.val() === true)),
      onValue(ref(db, '.info/serverTimeOffset'), (s) => this.serverOffset.set(s.val() ?? 0)),
    );
  }

  serverNow(): number {
    return this.now() + this.serverOffset();
  }

  dayStart(ts: number): number {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  /** Abonnement temps réel à l'historique d'une journée (minuit à minuit). */
  watchDay(dayStart: number, callback: (rows: Measure[]) => void): Unsubscribe {
    const q = query(
      ref(db, `${this.base}/history`),
      orderByChild('ts'),
      startAt(dayStart),
      endAt(dayStart + 86_400_000 - 1),
    );
    return onValue(q, (s) => {
      const rows: Measure[] = [];
      s.forEach((child) => {
        rows.push(child.val());
      });
      callback(rows);
    });
  }

  saveConfig(config: DeviceConfig): Promise<void> {
    return set(ref(db, `${this.base}/config`), config);
  }

  /** Démarre la vérification : l'ESP32 la termine quand l'utilisateur partage son contact au bot. */
  async startTelegramVerification(phone: string): Promise<void> {
    const digits = normalizePhone(phone);
    const code = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[b % 31]).join('');
    const link: TelegramLink = {
      phoneHash: await sha256Hex(digits),
      phoneLast2: digits.slice(-2),
      code,
      status: 'pending',
    };
    await set(ref(db, `${this.base}/telegram`), link);
  }

  removeTelegram(): Promise<void> {
    return remove(ref(db, `${this.base}/telegram`));
  }

  ngOnDestroy(): void {
    this.subs.forEach((unsub) => unsub());
    clearInterval(this.timer);
  }
}
