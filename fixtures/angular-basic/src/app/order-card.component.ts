import { Component, EventEmitter, Input, Output, input, output } from '@angular/core';

import type { OrderDto } from './order.dto';

/**
 * What a component is handed and what it emits, each spelled both ways the
 * framework allows: a decorated field and a signal (P35). Its node says it
 * takes `order` (required), `compact` and `currency`, and gives back `opened`
 * and `cancelled`.
 */
@Component({
  standalone: true,
  selector: 'app-order-card',
  template: `<article>{{ order.id }}</article>`,
})
export class OrderCardComponent {
  @Input({ required: true }) order!: OrderDto;
  @Input('dense') compact = false;
  readonly currency = input<string>('EUR');

  @Output() opened = new EventEmitter<OrderDto>();
  readonly cancelled = output<string>();

  private internal = 0;
}
