import { provideRouter, type Routes } from '@angular/router';

import { authGuard } from './auth.guard.js';
import { LoginComponent } from './login.component.js';
import { QueueComponent } from './queue.component.js';
import { StartComponent } from './start.component.js';

export const routes: Routes = [
  { path: '', component: StartComponent },
  { path: 'login', component: LoginComponent },
  { path: 'queue', component: QueueComponent, canActivate: [authGuard] },
];

export const appConfig = { providers: [provideRouter(routes)] };
