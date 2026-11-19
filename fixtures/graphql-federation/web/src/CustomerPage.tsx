import { useQuery } from '@apollo/client';

import { CUSTOMER } from './queries';

export const CustomerPage = ({ id }: { id: string }) => {
  const { data } = useQuery(CUSTOMER, { variables: { id } });
  return (
    <section>
      <h1>{data?.customer?.name}</h1>
      <p>{data?.customer?.orders.length} orders</p>
    </section>
  );
};
