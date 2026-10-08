import { Pipe } from '@angular/core';

import type { OrderDto } from './order.dto';

/**
 * A pipe's signature is its `transform` (P40): it takes an order and an
 * optional currency, and gives back text.
 */
@Pipe({ standalone: true, name: 'orderTotal' })
export class OrderTotalPipe {
  transform(order: OrderDto, currency = 'EUR'): string {
    return `${order.id} ${currency}`;
  }
}
