import type { Routes } from '@angular/router';

import { AnalyticsComponent } from './analytics.component';
import { authGuard, roleGuard } from './auth.guard';
import { DashboardComponent } from './dashboard.component';
import { LoginComponent } from './login.component';
import { MatrixComponent } from './matrix.component';
import { OrderHistoryComponent } from './order-history.component';
import { OrdersAdminComponent } from './orders-admin.component';
import { SettingsComponent } from './settings.component';
import { TicketBoardComponent } from './ticket-board.component';
import { TicketDetailComponent } from './ticket-detail.component';
import { TicketFormComponent } from './ticket-form.component';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: 'dashboard', component: DashboardComponent, canActivate: [authGuard] },
  { path: 'history', component: OrderHistoryComponent, canActivate: [authGuard] },
  { path: 'analytics', component: AnalyticsComponent, canActivate: [authGuard, roleGuard] },
  { path: 'analytics/matrix', component: MatrixComponent, canActivate: [authGuard, roleGuard] },
  { path: 'settings', component: SettingsComponent, canActivate: [authGuard] },
  { path: 'orders', component: OrdersAdminComponent, canActivate: [authGuard, roleGuard] },
  { path: 'board', component: TicketBoardComponent, canActivate: [authGuard] },
  { path: 'tickets/new', component: TicketFormComponent, canActivate: [authGuard] },
  { path: 'tickets/:ticketId/edit', component: TicketFormComponent, canActivate: [authGuard] },
  { path: 'tickets/:ticketId', component: TicketDetailComponent, canActivate: [authGuard] },
];
