import { Component } from '@angular/core';

import { OrdersApiService } from './orders-api.service';

/** The screen the router shows at `/board`: its button requests the route through the client. */
@Component({
  standalone: true,
  selector: 'app-status-board',
  template: `<button (click)="markReady('42')">Ready</button>`,
})
export class StatusBoardComponent {
  constructor(private readonly api: OrdersApiService) {}

  markReady(orderId: string): void {
    this.api.setStatus(orderId, 'ready').subscribe();
  }
}
