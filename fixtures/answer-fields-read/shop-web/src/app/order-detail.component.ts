import { Component, type OnInit } from '@angular/core';
import { OrdersService, type OrderDetail } from './orders.service';

/** `/orders/:id`: one order, stored in a member when it arrives and read by the template and a method. */
@Component({
  standalone: true,
  selector: 'app-order-detail',
  template: `
    <h1>{{ order?.customer.name }}</h1>
    @for (line of order?.lines; track line.sku) {
      <p>{{ line.sku }} x{{ line.qty }}</p>
    }
    <p>{{ lineCount }} lines</p>
    <button (click)="email(order)">Email the customer</button>
  `,
})
export class OrderDetailComponent implements OnInit {
  order: OrderDetail | undefined;
  lineCount = 0;

  constructor(private readonly orders: OrdersService) {}

  ngOnInit(): void {
    this.orders.one('current').subscribe((order) => {
      this.order = order;
      this.lineCount = order.lines.length;
    });
  }

  email(order: OrderDetail): void {
    location.href = `mailto:${order.customer.email}`;
  }
}
