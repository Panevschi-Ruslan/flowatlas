import { gql, useQuery } from '@apollo/client';

const BOARD = gql`
  query Board {
    orders {
      id
      customer {
        name
        orders {
          id
        }
      }
    }
  }
`;

export const OrdersBoard = () => {
  const { data } = useQuery(BOARD);
  return (
    <ol>
      {data?.orders.map((order) => (
        <li key={order.id}>{order.customer.name}</li>
      ))}
    </ol>
  );
};
