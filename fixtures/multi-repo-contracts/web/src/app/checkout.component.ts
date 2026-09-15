import { Component } from '@angular/core';

import { OrdersApiService } from './orders-api.service';

/**
 * The screen that places the order.
 *
 * Without a caller the request would be made from a service method nothing
 * reaches, and a disagreement found there is reported as a warning rather than
 * an error. This is what makes the browser's findings the errors they are.
 */
@Component({ selector: 'app-checkout', template: '<button (click)="place()">Place</button>' })
export class CheckoutComponent {
  constructor(private readonly orders: OrdersApiService) {}

  place(): void {
    this.orders
      .create({
        customerId: 'c1',
        channel: 'web',
        note: '',
        total: { amount: 1, currency: 'MDL' },
        shipTo: { line1: 'a', city: 'b' },
      })
      .subscribe();
  }
}
