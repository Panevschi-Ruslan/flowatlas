import { Component } from '@angular/core';

import { OrdersClient } from './orders.client';
import { Toast } from './toast.service';

/** `/orders/:orderId`: its button cancels the order. */
@Component({
  standalone: true,
  selector: 'app-order-detail',
  template: `<button (click)="cancel()">Cancel</button>`,
})
export class OrderDetailComponent {
  orderId = '';

  constructor(
    private readonly client: OrdersClient,
    private readonly toast: Toast,
  ) {}

  cancel(): void {
    this.client.cancel(this.orderId, 'me').subscribe(() => this.toast.showInfo('Cancelled'));
  }
}
