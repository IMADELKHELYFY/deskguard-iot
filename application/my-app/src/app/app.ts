import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Icon } from './icon';
import { TelemetryService } from './telemetry.service';
import { UiService } from './ui.service';

type NotifState = NotificationPermission | 'unsupported';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly tm = inject(TelemetryService);
  protected readonly ui = inject(UiService);
  protected readonly t = this.ui.t;

  /** Alerte affichée en surimpression tant que l'état n'est pas revenu au vert. */
  protected readonly alertOpen = signal(false);
  protected readonly notif = signal<NotifState>(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);

  protected readonly alertText = computed(() => {
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

  private lastAlertKey: string | null = null;

  constructor() {
    effect(() => {
      const l = this.tm.live();
      if (!l || !this.tm.online()) return;
      const key = l.state === 'green' ? 'green' : `${l.state}:${l.reason}`;
      if (key === this.lastAlertKey) return;
      const firstValue = this.lastAlertKey === null;
      this.lastAlertKey = key;
      if (key === 'green') {
        this.alertOpen.set(false);
        return;
      }
      this.alertOpen.set(true);
      // Pas de notification pour une alerte déjà en cours à l'ouverture de l'app
      if (!firstValue) untracked(() => this.notify(this.t().state[l.state], this.alertText()));
    });
  }

  protected async enableNotifications(): Promise<void> {
    if (typeof Notification === 'undefined') return;
    this.notif.set(await Notification.requestPermission());
  }

  private notify(title: string, body: string): void {
    navigator.vibrate?.([200, 100, 200]);
    if (this.notif() !== 'granted') return;
    try {
      new Notification(`DeskGuard · ${title}`, { body, tag: 'deskguard-alert', icon: 'favicon.ico' });
    } catch {
      /* Android Chrome exige un service worker : on garde l'alerte à l'écran */
    }
  }
}
