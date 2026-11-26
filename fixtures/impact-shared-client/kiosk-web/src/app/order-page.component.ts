import { Component } from '@angular/core';

import { KioskClient } from './kiosk.client';

/** `/order`: injects the kiosk's client for `order` and `forward`, neither of which reaches `GET /api/items`. */
@Component({
  standalone: true,
  selector: 'app-order-page',
  template: `<button (click)="place('lamp')">Order</button><button (click)="help()">Help</button>`,
})
export class OrderPageComponent {
  constructor(private readonly kiosk: KioskClient) {}

  place(name: string): void {
    this.kiosk.order(name).subscribe();
  }

  help(): void {
    this.kiosk.forward('help/topics').subscribe();
  }
}
