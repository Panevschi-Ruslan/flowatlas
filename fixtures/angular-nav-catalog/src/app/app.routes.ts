import type { Routes } from '@angular/router';

import { observerGuard } from './guards';
import { ShellComponent } from './layout/shell.component';
import { TelescopesComponent } from './pages/telescopes/telescopes.component';

/**
 * The shell at the root, its pages as children. `star-map` and `archive` are
 * loaded lazily; `telescopes` is named and guarded; `settings` mounts a file
 * of its own routes. No template links to `archive` at all.
 */
export const routes: Routes = [
  {
    path: '',
    component: ShellComponent,
    children: [
      {
        path: 'star-map',
        loadComponent: () => import('./pages/star-map/star-map.component').then((m) => m.StarMapComponent),
      },
      { path: 'telescopes', component: TelescopesComponent, canActivate: [observerGuard] },
      {
        path: 'archive',
        loadComponent: () => import('./pages/archive/archive.component').then((m) => m.ArchiveComponent),
      },
      { path: 'settings', loadChildren: () => import('./settings/settings.routes') },
    ],
  },
  { path: '**', redirectTo: '' },
];
