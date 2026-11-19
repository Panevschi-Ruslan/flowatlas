import { gql, useQuery } from '@apollo/client';

const ITEM = gql`
  query Item($id: ID!) {
    wishItem(id: $id) {
      name
      price
    }
  }
`;

export const ItemCard = ({ id }: { id: string }) => {
  const { data } = useQuery(ITEM, { variables: { id } });
  return <p>{data?.wishItem?.name}</p>;
};
