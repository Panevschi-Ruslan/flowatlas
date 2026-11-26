import { Component } from '@angular/core';
import type { OnInit } from '@angular/core';
import { OrdersApiService } from './orders-api.service';

/** `/orders`: loads an order and its reserved stock, and cancels it. */
@Component({
  standalone: true,
  selector: 'app-orders',
  template: `<p>{{ formatTotal(total) }}</p><button (click)="cancel()">Cancel</button>`,
})
export class OrdersPageComponent implements OnInit {
  orderId = 'current';
  total = 0;

  constructor(private readonly api: OrdersApiService) {}

  ngOnInit(): void {
    this.api.getOrder(this.orderId).subscribe();
    this.api.reservedStock(this.orderId).subscribe((count) => (this.total = count));
  }

  cancel(): void {
    this.api.cancelOrder(this.orderId, 'changed my mind').subscribe();
  }

  /** Only this screen uses it: a prompt naming it gets no card. */
  formatTotal(total: number): string {
    return `${total} reserved`;
  }
}
