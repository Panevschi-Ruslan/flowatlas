import { Component, Input } from '@angular/core';
import type { OrderSummary } from './orders.service';

/** A child the list binds each order to: it reads the status. */
@Component({
  standalone: true,
  selector: 'app-order-badge',
  template: `<span class="badge">{{ order.status }}</span>`,
})
export class OrderBadgeComponent {
  @Input() order!: OrderSummary;
}
