import { Pipe } from '@angular/core';

import type { OrderDto } from './order.dto';

/**
 * A pipe's signature is its `transform` (P40): it takes an order and an
 * optional currency, and gives back text. It says it is impure, so Angular runs
 * it on every change detection, and its node says so (P45).
 */
@Pipe({ standalone: true, name: 'orderTotal', pure: false })
export class OrderTotalPipe {
  transform(order: OrderDto, currency = 'EUR'): string {
    return `${order.id} ${currency}`;
  }
}
