import { Component } from '@angular/core';
import { OrdersClient } from './orders.client';
import { PaymentsClient } from './payments.client';

/** `/orders`: the list, a button that cancels an order and one that pays for it. */
@Component({
  standalone: true,
  selector: 'app-orders',
  template: `<button (click)="load()">Load</button><button (click)="cancelOne('1')">Cancel</button><button (click)="payOne('1')">Pay</button>`,
})
export class OrdersComponent {
  constructor(
    private readonly orders: OrdersClient,
    private readonly payments: PaymentsClient,
  ) {}

  load(): void {
    this.orders.list().subscribe();
  }

  cancelOne(orderId: string): void {
    this.orders.cancel(orderId).subscribe();
  }

  payOne(orderId: string): void {
    this.payments.pay(orderId, 10).subscribe();
  }
}
