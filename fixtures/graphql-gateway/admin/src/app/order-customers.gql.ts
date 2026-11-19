import { Injectable } from '@angular/core';
import { gql, Query } from 'apollo-angular';

@Injectable({ providedIn: 'root' })
export class OrderCustomersGQL extends Query<{ orders: Array<{ id: string }> }> {
  override document = gql`
    query OrderCustomers {
      orders {
        id
        customer {
          id
          name
        }
      }
    }
  `;
}
