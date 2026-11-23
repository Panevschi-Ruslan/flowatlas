import { Component } from '@angular/core';

import { StoreClient } from './store.client';

/** `/checkout`: one button places the order, the other cancels it. */
@Component({
  standalone: true,
  selector: 'app-checkout',
  template: `<button (click)="place()">Place</button><button (click)="cancel()">Cancel</button>`,
})
export class CheckoutComponent {
  sku = 'basket';

  constructor(private readonly client: StoreClient) {}

  place(): void {
    this.client.place(this.sku, 1).subscribe();
  }

  cancel(): void {
    this.client.cancel(this.sku).subscribe();
  }
}
