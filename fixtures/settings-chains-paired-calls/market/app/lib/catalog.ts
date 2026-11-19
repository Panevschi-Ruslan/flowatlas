import { gql, request } from 'graphql-request';
import { APP_URL } from './urls.js';

/** The listings, rooted at the first setting of a chain of `||`. */
export async function readListings() {
  const res = await fetch(`${APP_URL}/api/listings`);
  return res.json();
}

/** The ledger's entries, at a setting nothing gives a value: named after the service. */
export async function readEntries() {
  const res = await fetch(`${process.env.LEDGER_URL}/api/entries`);
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

/** The latest reviews, at a setting whose only value is a deployment's public host. */
export async function readReviews() {
  return request(`${process.env.REVIEWS_API_URL}`, LATEST_REVIEWS);
}
