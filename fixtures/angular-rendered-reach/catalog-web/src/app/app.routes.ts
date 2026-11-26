import type { Routes } from '@angular/router';

import { CatalogPageComponent } from './catalog-page.component';
import { ReportsPageComponent } from './reports-page.component';
import { SettingsPageComponent } from './settings-page.component';

export const routes: Routes = [
  { path: 'catalog', component: CatalogPageComponent },
  { path: 'settings', component: SettingsPageComponent },
  { path: 'reports', component: ReportsPageComponent },
];
