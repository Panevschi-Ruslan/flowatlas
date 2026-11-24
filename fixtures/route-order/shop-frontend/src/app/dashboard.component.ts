import { Component } from '@angular/core';
import { BillingApi } from './billing-api.service';
import { CatalogApi } from './catalog-api.service';
import { OrdersApi } from './orders-api.service';

/** `/dashboard`: the latest order, the featured items and what is overdue. */
@Component({
  standalone: true,
  selector: 'app-dashboard',
  template: `<button (click)="load()">Load</button><button (click)="download()">Export</button>`,
})
export class DashboardComponent {
  constructor(
    private readonly orders: OrdersApi,
    private readonly catalog: CatalogApi,
    private readonly billing: BillingApi,
  ) {}

  load(): void {
    this.orders.summary().subscribe();
    this.orders.latest().subscribe();
    this.catalog.featured().subscribe();
    this.catalog.newest().subscribe();
    this.billing.overdue().subscribe();
  }

  download(): void {
    this.orders.exportAll().subscribe();
  }
}
