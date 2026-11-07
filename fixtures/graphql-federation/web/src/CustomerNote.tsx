import { useQuery } from '@apollo/client';

import { CUSTOMER_NOTE } from './queries';

export const CustomerNote = ({ id }: { id: string }) => {
  const { data } = useQuery(CUSTOMER_NOTE, { variables: { id } });
  return <aside>{data?.customer?.internalNote}</aside>;
};
