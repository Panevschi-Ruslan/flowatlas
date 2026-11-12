import { Component } from '@angular/core';
import { Apollo, gql } from 'apollo-angular';

import { OrderCustomersGQL } from './order-customers.gql';

const ORDER_TOTALS = gql`
  query OrderTotals {
    orders {
      id
      total
    }
  }
`;

@Component({
  selector: 'app-orders',
  template: '<button (click)="refresh()">Refresh</button>',
})
export class OrdersComponent {
  constructor(
    private readonly apollo: Apollo,
    private readonly orderCustomers: OrderCustomersGQL,
  ) {}

  refresh(): void {
    this.apollo.watchQuery({ query: ORDER_TOTALS }).valueChanges.subscribe();
    this.orderCustomers.watch().valueChanges.subscribe();
  }
}
