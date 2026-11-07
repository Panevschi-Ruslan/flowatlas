import { gql, useQuery } from '@apollo/client';

const CUSTOMER = gql`
  query Customer($id: ID!) {
    customer(id: $id) {
      name
      orders {
        id
        total
      }
    }
  }
`;

export const CustomerPage = ({ id }: { id: string }) => {
  const { data } = useQuery(CUSTOMER, { variables: { id } });
  return (
    <section>
      <h1>{data?.customer?.name}</h1>
      <p>{data?.customer?.orders.length} orders</p>
    </section>
  );
};
