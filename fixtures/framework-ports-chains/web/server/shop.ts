import { gql, request } from 'graphql-request';

/** The items, under a public host with no path: the one service serving the path. */
export async function readItems() {
  const res = await fetch(`${process.env.SHOP_HOST}/items`);
  return res.json();
}

/** The shop's health, a path two services serve. */
export async function readHealth() {
  const res = await fetch(`${process.env.SHOP_HOST}/health`);
  return res.json();
}

const LATEST_REVIEWS = gql`
  query LatestReviews {
    reviews {
      id
      stars
    }
  }
`;

/** The latest reviews, through a gateway whose path is not the endpoint's. */
export async function readReviews() {
  return request(`${process.env.GATEWAY_URL}`, LATEST_REVIEWS);
}
