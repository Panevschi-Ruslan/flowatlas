import { gql } from '@apollo/client';

export const ORDERS = gql`
  query Orders {
    orders {
      id
      total
      customer {
        id
        name
        email
      }
    }
  }
`;

export const CUSTOMER = gql`
  query Customer($id: ID!) {
    customer(id: $id) {
      name
      orders {
        id
        total
      }
    }
  }
`;

export const REGIONS = gql`
  query Regions {
    regions
  }
`;

export const ORDER_BADGE = gql`
  query OrderBadge {
    orders {
      id
      discount
    }
  }
`;

export const CUSTOMER_NOTE = gql`
  query CustomerNote($id: ID!) {
    customer(id: $id) {
      internalNote
    }
  }
`;
