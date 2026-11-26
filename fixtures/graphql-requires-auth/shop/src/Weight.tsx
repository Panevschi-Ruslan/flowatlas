import { gql, useQuery } from '@apollo/client';

/** Selects the weight itself as well: the router checks @authenticated on that selection. */
const WEIGHT = gql`
  query Weight($id: ID!) {
    product(id: $id) {
      estimate
      weight
    }
  }
`;

export const Weight = ({ id }: { id: string }) => {
  const { data } = useQuery(WEIGHT, { variables: { id } });
  return <p>{data?.product?.weight}</p>;
};
