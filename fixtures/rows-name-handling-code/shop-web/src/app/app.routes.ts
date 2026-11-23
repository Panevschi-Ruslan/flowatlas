import type { Routes } from '@angular/router';

import { DeskBoardComponent } from './desk-board.component';
import { OrderDetailComponent } from './order-detail.component';

export const routes: Routes = [
  { path: 'orders/:orderId', component: OrderDetailComponent },
  { path: 'desks', component: DeskBoardComponent },
];
