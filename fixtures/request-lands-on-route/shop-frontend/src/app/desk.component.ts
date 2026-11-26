import { Component } from '@angular/core';
import { DeskOrderService } from './desk-order.service';

/** `/desk`: the desk amends an order's lines. */
@Component({
  standalone: true,
  selector: 'app-desk',
  template: `<button (click)="amend()">Amend</button>`,
})
export class DeskComponent {
  orderId = 'current';

  constructor(private readonly orders: DeskOrderService) {}

  amend(): void {
    this.orders.amendOrder(this.orderId, ['one']).subscribe();
  }
}
