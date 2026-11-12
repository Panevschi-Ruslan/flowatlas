import gql from 'graphql-tag';

import { runQuietQuery } from './client';

const OrdersDocument = gql`
  query Orders {
    orders {
      id
      total
    }
  }
`;

const OrderDocument = gql`
  query Order($id: String!) {
    order(id: $id) {
      id
    }
  }
`;

export const listOrders = () => runQuietQuery({ query: OrdersDocument, variables: {} });

/** A caller outside any function: a class whose method hands the document. */
export class OrderWatcher {
  load(id: string) {
    return runQuietQuery({ query: OrderDocument, variables: { id } });
  }
}
