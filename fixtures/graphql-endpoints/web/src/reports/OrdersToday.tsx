import { gql, useQuery, type ApolloClient } from '@apollo/client';

const ORDERS_TODAY = gql`
  query OrdersToday {
    ordersToday
  }
`;

/** Sent with whatever client the parent hands in: not followed. */
export const OrdersToday = ({ reportsClient }: { reportsClient: ApolloClient<unknown> }) => {
  const { data } = useQuery(ORDERS_TODAY, { client: reportsClient });
  return <span>{data?.ordersToday}</span>;
};
