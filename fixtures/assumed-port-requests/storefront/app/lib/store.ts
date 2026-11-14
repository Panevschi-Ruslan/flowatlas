import { gql, request } from 'graphql-request';

const PRODUCTS = gql`
  query Products {
    products {
      id
      name
    }
  }
`;

const ADD_TO_CART = gql`
  mutation AddToCart($productId: ID!) {
    addToCart(productId: $productId) {
      id
    }
  }
`;

/** The store's products, from the server's API at the address the example environment gives. */
export async function listProducts() {
  return request(`${process.env.STORE_API_URL}`, PRODUCTS);
}

/** A product added to the cart, through the same API. */
export async function addToCart(productId: string) {
  return request(`${process.env.STORE_API_URL}`, ADD_TO_CART, { productId });
}

/** The cart, from the application's own route, at the port it listens on by default. */
export async function readCart() {
  const res = await fetch(`${process.env.APP_URL ?? 'http://localhost:3000'}/api/cart`);
  return res.json();
}
