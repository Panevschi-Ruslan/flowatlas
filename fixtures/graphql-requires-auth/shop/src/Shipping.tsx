import { gql, useQuery } from '@apollo/client';

/** Selects the estimate alone: the router fetches the weight for it, and checks nothing for that fetch. */
const ESTIMATE = gql`
  query Estimate($id: ID!) {
    product(id: $id) {
      name
      estimate
    }
  }
`;

export const Shipping = ({ id }: { id: string }) => {
  const { data } = useQuery(ESTIMATE, { variables: { id } });
  return <p>{data?.product?.estimate}</p>;
};
