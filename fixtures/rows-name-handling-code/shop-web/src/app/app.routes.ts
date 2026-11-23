import type { Routes } from '@angular/router';

import { DeskBoardComponent } from './desk-board.component';
import { OrderDetailComponent } from './order-detail.component';
import { ReportsComponent } from './reports.component';

export const routes: Routes = [
  { path: 'orders/:orderId', component: OrderDetailComponent },
  { path: 'desks', component: DeskBoardComponent },
  { path: 'reports', component: ReportsComponent },
];
