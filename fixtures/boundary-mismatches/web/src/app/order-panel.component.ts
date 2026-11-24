import { Component } from '@angular/core';
import { AccountsApiService } from './accounts-api.service';
import { LiveService } from './live.service';
import { OrdersApiService } from './orders-api.service';

/** The screen every request and stream starts from. */
@Component({
  selector: 'app-order-panel',
  standalone: true,
  template: `
    <button (click)="load()">Load</button>
    <button (click)="place()">Place</button>
    <button (click)="cancel('o1')">Cancel</button>
    <button (click)="refund('o1')">Refund</button>
    <button (click)="rename('o1')">Rename</button>
    <button (click)="remove('o1')">Remove</button>
    <button (click)="watch()">Watch</button>
  `,
})
export class OrderPanelComponent {
  message = '';

  constructor(
    private readonly orders: OrdersApiService,
    private readonly accounts: AccountsApiService,
    private readonly live: LiveService,
  ) {}

  load(): void {
    this.orders.list().subscribe();
    this.accounts.me().subscribe();
  }

  place(): void {
    this.orders.create('lamp', 1).subscribe();
  }

  /** The cancel route answers 409 and 404, and never 410: the 410 branch is dead. */
  cancel(id: string): void {
    this.orders.cancel(id).subscribe({
      error: (err) => {
        if (err.status === 409) this.message = 'already shipped';
        else if (err.status === 410) this.message = 'cancelled long ago';
      },
    });
  }

  refund(id: string): void {
    this.orders.refund(id).subscribe();
  }

  rename(id: string): void {
    this.orders.rename(id, 'gift').subscribe();
  }

  remove(id: string): void {
    this.orders.remove(id).subscribe();
  }

  watch(): void {
    this.live.watchReady();
    this.live.watchFeed();
    this.live.watchNotices();
  }
}
