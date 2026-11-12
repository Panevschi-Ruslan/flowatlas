import { inject } from '@angular/core';
import { provideRouter, type Routes } from '@angular/router';

import { AdminGuard } from './admin.guard.js';
import { requireSession, roleGuard, totalsResolver } from './guards.js';
import { ReportsComponent } from './reports.component.js';
import { SessionService } from './session.service.js';
import { SignInComponent } from './sign-in.component.js';
import { StartComponent } from './start.component.js';
import { UsersComponent } from './users.component.js';

export const routes: Routes = [
  { path: '', component: StartComponent },
  { path: 'sign-in', component: SignInComponent, canActivate: [() => !inject(SessionService).isSignedIn()] },
  { path: 'reports', component: ReportsComponent, canActivate: [requireSession], resolve: { totals: totalsResolver } },
  {
    path: 'admin',
    canActivate: [requireSession],
    canActivateChild: [AdminGuard],
    children: [{ path: 'users', component: UsersComponent, canActivate: [roleGuard('owner')] }],
  },
];

export const appConfig = { providers: [provideRouter(routes)] };
