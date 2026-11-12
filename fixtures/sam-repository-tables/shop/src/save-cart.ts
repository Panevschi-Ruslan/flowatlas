import { CartStore } from './orders';

export const handler = async (event: { body: string }) => {
  const cart = JSON.parse(event.body) as { id: string; items: string[] };
  await new CartStore().put(cart);
  return { statusCode: 204 };
};
