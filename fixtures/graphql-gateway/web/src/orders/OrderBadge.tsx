import { useQuery } from '@apollo/client';

import { ORDER_BADGE } from './queries';

export const OrderBadge = ({ id }: { id: string }) => {
  const { data } = useQuery(ORDER_BADGE, { variables: { id } });
  return <span>{data?.order.discount}</span>;
};
