import { Component } from '@angular/core';

import { OrdersApiService } from './orders-api.service';

/** A template in a file of its own, and a module that declares it. */
@Component({
  selector: 'app-orders-list',
  templateUrl: './orders-list.component.html',
})
export class OrdersListComponent {
  constructor(private readonly orders: OrdersApiService) {}

  reload(): void {
    this.orders.list();
  }
}
