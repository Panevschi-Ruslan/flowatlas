import { Component, inject } from '@angular/core';
import { OrderBadgeComponent } from './order-badge.component';
import { OrdersService } from './orders.service';

/** `/orders`: the list, held as an observable and read through the async pipe. */
@Component({
  standalone: true,
  selector: 'app-orders',
  imports: [OrderBadgeComponent],
  template: `
    <ul>
      @for (order of orders$ | async; track order.id) {
        <li>{{ order.total }} less {{ order.discount }}</li>
        <app-order-badge [order]="order" />
      }
    </ul>
  `,
})
export class OrdersComponent {
  private readonly orders = inject(OrdersService);
  readonly orders$ = this.orders.list();
}
