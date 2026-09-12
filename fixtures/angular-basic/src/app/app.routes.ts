import type { Routes } from '@angular/router';

import { CheckoutComponent } from './checkout.component';
import { OrdersListComponent } from './orders-list.component';

/** Where a screen written in a variable rather than in the route comes from. */
const page = (name: string): string => `./${name}.component`;

/**
 * What each link in a template opens, which is what makes `triggers` possible.
 *
 * The first two routes name their screen and the next three load it. Naming and
 * loading are the same fact written differently — the module and the export are
 * both in the source either way — so a link to `/settings` reaches its screen
 * exactly as a link to `/orders/:id` does. The last one is what a loader looks
 * like when nobody can read it: the specifier is a value, so no module is named
 * and the route is honest about having no screen.
 */
export const routes: Routes = [
  { path: '', component: CheckoutComponent },
  { path: 'orders/:id', component: OrdersListComponent },
  {
    path: 'settings',
    loadComponent: () => import('./settings.component').then((m) => m.SettingsComponent),
  },
  { path: 'reports', loadComponent: () => import('./reports.component') },
  {
    path: 'profile',
    loadComponent: async () => (await import('./profile.component')).ProfileComponent,
  },
  { path: 'archive', loadComponent: () => import(page('archive')).then((m) => m.ArchiveComponent) },
];
