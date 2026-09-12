import { Component } from '@angular/core';

import { OrdersApiService } from './orders-api.service';

/**
 * The button the plan's whole chain starts at.
 *
 * `(click)="checkout()"` reaches `checkout`, which reaches
 * `OrdersApiService.order`, which is one `GET /orders/:param` on the gateway,
 * which is where the eight hops the linker already joins begin.
 */
@Component({
  standalone: true,
  selector: 'app-checkout',
  template: `<button (click)="checkout()">Checkout</button>`,
})
export class CheckoutComponent {
  constructor(private readonly orders: OrdersApiService) {}

  checkout(): void {
    this.orders.order('1');
  }
}
