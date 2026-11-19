import { gql, useQuery } from '@apollo/client';

const WISHLIST = gql`
  query Wishlist {
    me {
      email
      wishlist {
        name
        price
      }
    }
  }
`;

export const WishlistPage = () => {
  const { data } = useQuery(WISHLIST);
  return <p>{data?.me?.wishlist.length} wished for</p>;
};
