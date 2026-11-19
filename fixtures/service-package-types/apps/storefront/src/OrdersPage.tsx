import { gql, useQuery } from '@apollo/client';

import { client } from './client';

const ORDERS = gql`
  query Orders {
    orders {
      id
      status
    }
  }
`;

/** Declares nothing of the API: its operations were the ones left ambiguous. */
export const OrdersPage = () => {
  const { data } = useQuery(ORDERS, { client });
  return <ul>{data?.orders.map((order) => <li key={order.id}>{order.status}</li>)}</ul>;
};

export const checkHealth = () => fetch(`${import.meta.env.VITE_API_URL}/v1/health`);
