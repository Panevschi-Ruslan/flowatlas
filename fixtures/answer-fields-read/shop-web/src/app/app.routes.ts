import type { Routes } from '@angular/router';

import { OrderDetailComponent } from './order-detail.component';
import { OrdersComponent } from './orders.component';

export const routes: Routes = [
  { path: 'orders', component: OrdersComponent },
  { path: 'orders/:id', component: OrderDetailComponent },
];
