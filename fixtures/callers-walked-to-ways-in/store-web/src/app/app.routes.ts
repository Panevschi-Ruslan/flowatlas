import type { Routes } from '@angular/router';

import { CatalogComponent } from './catalog.component';
import { CheckoutComponent } from './checkout.component';
import { ProductEditComponent } from './product-edit.component';
import { ReportComponent } from './report.component';

export const routes: Routes = [
  { path: 'checkout', component: CheckoutComponent },
  { path: 'reports', component: ReportComponent },
  { path: 'catalog', component: CatalogComponent },
  { path: 'catalog/:sku', component: ProductEditComponent },
];
