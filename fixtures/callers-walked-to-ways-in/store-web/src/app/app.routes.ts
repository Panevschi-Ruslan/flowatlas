import type { Routes } from '@angular/router';

import { CheckoutComponent } from './checkout.component';
import { ReportComponent } from './report.component';

export const routes: Routes = [
  { path: 'checkout', component: CheckoutComponent },
  { path: 'reports', component: ReportComponent },
];
