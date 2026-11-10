import { provideRouter, type Routes } from '@angular/router';

import { DashboardComponent } from './dashboard.component.js';
import { InvoiceComponent } from './invoice.component.js';
import { InvoicesComponent } from './invoices.component.js';

export const routes: Routes = [
  { path: '', component: DashboardComponent },
  { path: 'invoices', component: InvoicesComponent },
  { path: 'invoices/:id', component: InvoiceComponent },
];

export const appConfig = { providers: [provideRouter(routes)] };
