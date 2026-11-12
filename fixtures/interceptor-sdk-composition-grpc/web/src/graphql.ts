import { request } from 'graphql-request';
import gql from 'graphql-tag';

/** Every GraphQL query of the storefront, the document handed in. */
export const runQuery = (document: string) => request('/graphql', document);

export const CartDocument = gql`
  query cartLines {
    cart {
      id
    }
  }
`;

export const OrdersDocument = gql`
  query orderList {
    orders {
      id
    }
  }
`;
