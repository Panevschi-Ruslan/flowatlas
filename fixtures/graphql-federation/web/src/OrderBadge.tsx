import { useQuery } from '@apollo/client';

import { ORDER_BADGE } from './queries';

export const OrderBadge = () => {
  const { data } = useQuery(ORDER_BADGE);
  return <span>{data?.orders.length}</span>;
};
