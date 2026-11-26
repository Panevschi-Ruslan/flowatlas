import type { Routes } from '@angular/router';

import { CatalogPageComponent } from './catalog-page.component';
import { HistoryPageComponent } from './history-page.component';
import { ReportsPageComponent } from './reports-page.component';
import { SettingsPageComponent } from './settings-page.component';
import { StaffBoardComponent } from './staff-board.component';
import { StaffDeskDetailComponent } from './staff-desk-detail.component';
import { StaffOrderComponent } from './staff-order.component';

export const routes: Routes = [
  { path: 'history', component: HistoryPageComponent },
  { path: 'catalog', component: CatalogPageComponent },
  { path: 'reports', component: ReportsPageComponent },
  { path: 'settings', component: SettingsPageComponent },
  { path: 'staff', component: StaffBoardComponent },
  { path: 'staff/orders', component: StaffOrderComponent },
  { path: 'staff/orders/:orderId', component: StaffOrderComponent },
  { path: 'staff/archive/orders', component: StaffOrderComponent },
  { path: 'staff/desks/:deskId', component: StaffDeskDetailComponent },
];
