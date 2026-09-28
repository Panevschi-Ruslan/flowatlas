import type { Routes } from '@angular/router';

import { PluginsComponent } from './plugins.component';

/** Spread into the children of `/admin/settings`, and mounted nowhere else. */
export const settingsRoutes: Routes = [{ path: 'plugins', component: PluginsComponent }];
