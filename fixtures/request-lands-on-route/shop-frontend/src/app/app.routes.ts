import type { Routes } from '@angular/router';

import { CatalogComponent } from './catalog.component';
import { DeskComponent } from './desk.component';

export const routes: Routes = [
  { path: 'catalog', component: CatalogComponent },
  { path: 'desk', component: DeskComponent },
];
