import type { Routes } from '@angular/router';

import { AdminShellComponent } from './admin-shell.component';
import { settingsRoutes } from './settings.routes';

/** What every route in this file has in common, including its path. */
const common = {
  path: '',
  providers: [],
};

/**
 * A lazy file, mounted under `/admin` by the loader in the root.
 *
 * The first route is spread from `common`, so its `path` is never written on the
 * object itself, and its children are spread in from another file. Both shapes
 * were invisible, and every link under `/admin` was dead because of it.
 */
export default [
  {
    ...common,
    path: 'settings',
    component: AdminShellComponent,
    children: [...settingsRoutes],
  },
  {
    path: 'reports',
    loadChildren: () => import('./reports.module').then((m) => m.ReportsModule),
  },
] satisfies Routes;
