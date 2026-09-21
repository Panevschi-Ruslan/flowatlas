import { Component } from '@angular/core';
import { LiveEventsService } from './live-events.service';
import { OrdersApiService } from './orders-api.service';

/**
 * Both ends of the round trip start here: one click cancels an order, the other
 * opens the stream on which the cancellation comes back.
 */
@Component({
  selector: 'app-orders',
  standalone: true,
  template: `
    <button (click)="watch()">Watch</button>
    <button (click)="cancel()">Cancel</button>
  `,
})
export class OrdersComponent {
  constructor(
    private readonly live: LiveEventsService,
    private readonly api: OrdersApiService,
  ) {}

  /**
   * A lifecycle hook written as a field (R29).
   *
   * Angular calls whatever the property holds, so this runs exactly as a
   * declared `ngOnInit` would. Asking only for a `MethodDeclaration` answered
   * nothing for it, and the screen lost its way in. Expected: a `ui_action`
   * node labelled `ngOnInit`, reaching the request below it.
   */
  ngOnInit = (): void => {
    this.api.cancel('r1', 'o1').subscribe();
  };

  watch(): void {
    this.live.open('r1');
  }

  cancel(): void {
    this.api.cancel('r1', 'o1').subscribe();
  }
}
