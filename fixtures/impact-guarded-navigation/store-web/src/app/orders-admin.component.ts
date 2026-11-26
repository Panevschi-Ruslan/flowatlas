import { Component } from '@angular/core';

import { OrdersClient } from './orders.client';

/** `/orders`: creates and removes orders, whose routes publish what the bot re-fetches on. */
@Component({
  standalone: true,
  selector: 'app-orders-admin',
  template: `<button (click)="create()">New</button><button (click)="remove('1')">Remove</button>`,
})
export class OrdersAdminComponent {
  constructor(private readonly orders: OrdersClient) {}

  create(): void {
    this.orders.create('main').subscribe();
  }

  remove(orderId: string): void {
    this.orders.remove('main', orderId).subscribe();
  }
}
