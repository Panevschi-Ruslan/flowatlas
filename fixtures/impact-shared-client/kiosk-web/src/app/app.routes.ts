import type { Routes } from '@angular/router';

import { BrowsePageComponent } from './browse-page.component';
import { OrderPageComponent } from './order-page.component';

export const routes: Routes = [
  { path: 'browse', component: BrowsePageComponent },
  { path: 'order', component: OrderPageComponent },
];
