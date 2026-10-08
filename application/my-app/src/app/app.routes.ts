import { Routes } from '@angular/router';
import { Dashboard } from './dashboard/dashboard';
import { History } from './history/history';
import { Settings } from './settings/settings';

export const routes: Routes = [
  { path: '', component: Dashboard, title: 'DeskGuard' },
  { path: 'historique', component: History, title: 'DeskGuard · Historique' },
  { path: 'reglages', component: Settings, title: 'DeskGuard · Réglages' },
  { path: '**', redirectTo: '' },
];
