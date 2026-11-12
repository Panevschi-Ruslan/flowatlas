import type { BasketItem } from '../lib/basket-store';

/**
 * The address of a shipping service this project does not hold, taken out of
 * the environment where it is declared rather than at each use: the read is
 * `process.env.SHIPPING_URL` all the same, and the request below is rooted at it.
 */
const { SHIPPING_URL = '' } = process.env;

export const quoteShipping = async (items: BasketItem[]): Promise<{ cost: number }> => {
  const response = await fetch(`${SHIPPING_URL}/quote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ items }),
  });
  return response.json();
};
