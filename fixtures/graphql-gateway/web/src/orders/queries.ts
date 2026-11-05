import { gql } from '@apollo/client';

export const ORDER_FIELDS = gql`
  fragment OrderFields on Order {
    id
    total
  }
`;

export const ORDERS = gql`
  query Orders {
    orders {
      ...OrderFields
      customer {
        name
      }
    }
  }
  ${ORDER_FIELDS}
`;

export const ORDER_BADGE = gql`
  query OrderBadge($id: ID!) {
    order(id: $id) {
      id
      discount
    }
  }
`;
