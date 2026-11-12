/** The basket, kept in memory: what the routes reach once their wrappers are taken off. */
export interface BasketItem {
  productId: string;
  quantity: number;
}

const baskets = new Map<string, BasketItem[]>();

export const readBasket = async (sessionId: string): Promise<BasketItem[]> => baskets.get(sessionId) ?? [];

export const addToBasket = async (sessionId: string, item: BasketItem): Promise<BasketItem[]> => {
  const items = [...(await readBasket(sessionId)), item];
  baskets.set(sessionId, items);
  return items;
};

export const emptyBasket = async (sessionId: string): Promise<void> => {
  baskets.delete(sessionId);
};

export const listProducts = async (): Promise<Array<{ id: string; name: string }>> => [
  { id: 'tea', name: 'Green tea' },
  { id: 'mug', name: 'Mug' },
];

export const listStores = async (): Promise<Array<{ id: string; city: string }>> => [{ id: 'north', city: 'Leeds' }];

/** Builds the handler a health probe answers with, from a name: a factory, not a wrapper. */
export const makeProbe = (options: { name: string }) => async (_request: unknown, response: { json(body: unknown): void }) => {
  response.json({ probe: options.name, ok: true });
};
