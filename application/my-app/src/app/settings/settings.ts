import { Component, computed, effect, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Icon } from '../icon';
import { TextKey } from '../i18n';
import { DEFAULT_CONFIG, DeviceConfig, TelemetryService, normalizePhone } from '../telemetry.service';
import { UiService } from '../ui.service';

type NumericKey = Exclude<keyof DeviceConfig, 'telegramOn'>;

interface Field {
  key: NumericKey;
  label: TextKey;
  tip: TextKey;
  min: number;
  max: number;
  step: number;
  unit: string;
}

const FIELDS: Field[] = [
  { key: 'distMin', label: 'distMin', tip: 'distMinTip', min: 30, max: 100, step: 5, unit: 'cm' },
  { key: 'proxDelayS', label: 'proxDelayS', tip: 'proxDelayTip', min: 0, max: 60, step: 1, unit: 's' },
  { key: 'imbalancePct', label: 'imbalancePct', tip: 'imbalanceTip', min: 10, max: 90, step: 5, unit: '%' },
  { key: 'luxCal', label: 'luxCal', tip: 'luxCalTip', min: 0.2, max: 5, step: 0.05, unit: '×' },
  { key: 'lightDelayS', label: 'lightDelayS', tip: 'lightDelayTip', min: 0, max: 60, step: 1, unit: 's' },
  { key: 'pauseMin', label: 'pauseMin', tip: 'pauseTip', min: 1, max: 90, step: 1, unit: 'min' },
  { key: 'sendPeriodS', label: 'sendPeriodS', tip: 'sendPeriodTip', min: 1, max: 10, step: 1, unit: 's' },
];

@Component({
  selector: 'app-settings',
  imports: [DecimalPipe, Icon],
  templateUrl: './settings.html',
})
export class Settings {
  protected readonly tm = inject(TelemetryService);
  protected readonly t = inject(UiService).t;
  protected readonly fields = FIELDS;

  protected readonly draft = signal<DeviceConfig>({ ...DEFAULT_CONFIG });
  protected readonly dirty = signal(false);
  protected readonly saveStatus = signal<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Telegram
  protected readonly phone = signal('');
  protected readonly phoneError = signal(false);
  protected readonly editingPhone = signal(false);
  protected readonly tgBusy = signal(false);
  protected readonly botLink = computed(() => {
    const bot = this.tm.telegramBot();
    const link = this.tm.telegram();
    return bot && link ? `https://t.me/${bot}?start=${link.code}` : null;
  });

  constructor() {
    effect(() => {
      const config = this.tm.config();
      if (!this.dirty()) this.draft.set({ ...config });
    });
  }

  protected patch(key: NumericKey, event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (Number.isNaN(value)) return;
    this.draft.update((d) => ({ ...d, [key]: value }));
    this.dirty.set(true);
    this.saveStatus.set('idle');
  }

  protected toggleTelegram(event: Event): void {
    this.draft.update((d) => ({ ...d, telegramOn: (event.target as HTMLInputElement).checked }));
    this.dirty.set(true);
    this.saveStatus.set('idle');
  }

  protected cancel(): void {
    this.dirty.set(false);
    this.saveStatus.set('idle');
  }

  protected async save(): Promise<void> {
    this.saveStatus.set('saving');
    try {
      await this.tm.saveConfig(this.draft());
      this.dirty.set(false);
      this.saveStatus.set('saved');
    } catch (err) {
      console.error(err);
      this.saveStatus.set('error');
    }
  }

  protected onPhoneInput(event: Event): void {
    this.phone.set((event.target as HTMLInputElement).value);
    this.phoneError.set(false);
  }

  protected async verifyPhone(): Promise<void> {
    if (normalizePhone(this.phone()).length < 9) {
      this.phoneError.set(true);
      return;
    }
    this.tgBusy.set(true);
    try {
      await this.tm.startTelegramVerification(this.phone());
      this.editingPhone.set(false);
    } finally {
      this.tgBusy.set(false);
    }
  }

  protected async removePhone(): Promise<void> {
    this.tgBusy.set(true);
    try {
      await this.tm.removeTelegram();
      this.phone.set('');
    } finally {
      this.tgBusy.set(false);
    }
  }
}
