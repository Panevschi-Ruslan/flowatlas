import { Component } from '@angular/core';
import { LiveEventsService } from './live-events.service';
import { OrdersApiService } from './orders-api.service';

/** One click opens the worker's stream, the other asks the controller. */
@Component({
  selector: 'app-orders',
  standalone: true,
  template: `
    <button (click)="watch()">Watch</button>
    <button (click)="load()">Load</button>
  `,
})
export class OrdersComponent {
  constructor(
    private readonly live: LiveEventsService,
    private readonly api: OrdersApiService,
  ) {}

  watch(): void {
    this.live.open('r1');
  }

  load(): void {
    this.api.list('r1').subscribe();
  }
}
