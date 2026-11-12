import { gql, useMutation } from '@apollo/client';
import { statusLabel } from '@shop/formatting';
// The API's package, declared for its types and one helper: its resolvers and
// controllers are the API's ways in, not this front end's.
import type { Order } from '@shop/api/src/orders/order.model';
import { orderNumber } from '@shop/api/src/orders/order-number';

import { client } from './client';

const CANCEL_ORDER = gql`
  mutation CancelOrder($id: ID!) {
    cancelOrder(id: $id) {
      id
      status
    }
  }
`;

export const CancelButton = ({ order }: { order: Order }) => {
  const [cancel] = useMutation(CANCEL_ORDER, { client });
  return (
    <button onClick={() => cancel({ variables: { id: order.id } })}>
      {orderNumber(order.id)} {statusLabel(order.status)}
    </button>
  );
};
