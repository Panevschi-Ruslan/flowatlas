import { Component } from '@angular/core';
import { OrdersApiService } from './orders-api.service';

/** One click lists the orders, the other places one. */
@Component({
  selector: 'app-orders',
  standalone: true,
  template: `
    <button (click)="load()">Load</button>
    <button (click)="place()">Place</button>
  `,
})
export class OrdersComponent {
  constructor(private readonly api: OrdersApiService) {}

  load(): void {
    this.api.list().subscribe();
  }

  place(): void {
    this.api.create(12).subscribe();
  }
}
