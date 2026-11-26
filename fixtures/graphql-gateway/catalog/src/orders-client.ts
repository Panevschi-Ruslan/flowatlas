import { gql, request } from 'graphql-request';

const ORDER_TOTALS = gql`
  query OrderTotals {
    orders {
      id
      total
    }
  }
`;

/** How many orders the orders service holds, asked of it over GraphQL. */
export const orderedCount = async (): Promise<number> => {
  const data = await request<{ orders: Array<{ id: string }> }>(`${process.env.ORDERS_URL}/graphql`, ORDER_TOTALS);
  return data.orders.length;
};
