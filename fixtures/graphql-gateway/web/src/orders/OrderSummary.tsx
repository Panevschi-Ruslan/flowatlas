import { useQuery } from '@apollo/client';

import OrderSummaryDocument from './order-summary.graphql';

export const OrderSummary = ({ id }: { id: string }) => {
  const { data } = useQuery(OrderSummaryDocument, { variables: { id } });
  return (
    <p>
      {data?.order.customer.name}: {data?.order.total}
    </p>
  );
};
