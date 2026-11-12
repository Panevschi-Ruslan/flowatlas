import { gql, useMutation, useQuery } from '@apollo/client';

import { useStoreClient } from '../apollo/StoreClientProvider';

const SHOPPER = gql`
  query Shopper {
    me {
      id
      name
    }
  }
`;

const ADD_TO_CART = gql`
  mutation AddToCart($productId: ID!) {
    addToCart(productId: $productId) {
      items
    }
  }
`;

const PRODUCTS = gql`
  query Products {
    products {
      id
    }
  }
`;

/** Sent with the storefront's client, handed down by its provider: the storefront's schema. */
export const CartButton = ({ productId }: { productId: string }) => {
  const client = useStoreClient();
  const { data } = useQuery(SHOPPER, { client });
  const { data: listed } = useQuery(PRODUCTS, { client });
  const [add] = useMutation(ADD_TO_CART, { client });
  return (
    <button onClick={() => add({ variables: { productId } })}>
      {data?.me.name} ({listed?.products.length})
    </button>
  );
};
