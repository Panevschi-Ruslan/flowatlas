import { Component } from '@angular/core';

import type { CancelOrder } from './order-events';
import { OrdersSocketService } from './orders-socket.service';

@Component({
  selector: 'app-orders',
  standalone: true,
  template: `
    <button (click)="cancel()">Cancel</button>
    <button (click)="summarise()">Summary</button>
  `,
})
export class OrdersComponent {
  orderId = 'order-1';

  constructor(private readonly sockets: OrdersSocketService) {}

  cancel(): void {
    const command: CancelOrder = { orderId: this.orderId, reason: 'changed mind' };
    this.sockets.cancel(command);
  }

  summarise(): void {
    this.sockets.requestSummary(this.orderId);
  }
}
