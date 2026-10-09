import { Component, EventEmitter, Input, Output, input, output } from '@angular/core';

import { HighlightDirective } from './highlight.directive';
import { OrderTotalPipe } from './order-total.pipe';
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
  imports: [HighlightDirective, OrderTotalPipe],
  template: `<article appHighlight>{{ order | orderTotal }}</article>`,
})
export class OrderCardComponent {
  @Input({ required: true }) order!: OrderDto;
  @Input('dense') compact = false;
  readonly currency = input<string>('EUR');

  @Output() opened = new EventEmitter<OrderDto>();
  readonly cancelled = output<string>();

  private internal = 0;
}
