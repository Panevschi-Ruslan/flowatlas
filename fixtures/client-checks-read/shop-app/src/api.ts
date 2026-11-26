import ky from 'ky';

/** The app's idea of an item: a `promo` and a `legacyCode` the API never sends. */
export interface Item {
  id: string;
  name: string;
  price: number;
  status: 'draft' | 'live' | 'sold';
  promo?: { text: string };
  legacyCode?: string;
}

export interface ItemStats {
  views: number;
  saves: number;
}

const stamp = (request: Request): void => {
  request.headers.set('x-trace', 'web');
};

/**
 * Every request through it starts at the API's base, carries the shop's
 * cookie and an `x-shop` header, and gets `x-trace` from its hook.
 */
export const api = ky.create({
  prefixUrl: import.meta.env.VITE_SHOP_URL,
  credentials: 'include',
  headers: { 'x-shop': 'web' },
  hooks: { beforeRequest: [stamp] },
});

/** The item and its counts asked for together: each answer is read at its own place of the pair. */
export async function loadItem(id: string): Promise<string> {
  const [item, stats] = await Promise.all([api.get(`api/items/${id}`).json<Item>(), api.get(`api/items/${id}/stats`).json<ItemStats>()]);
  const promo = item.promo ? item.promo.text : '';
  switch (item.status) {
    case 'draft':
      return `${item.name} (draft)`;
    case 'live':
      return `${item.name} ${item.price} ${promo} ${stats.views}`;
    default:
      return `${item.name} ${item.legacyCode}`;
  }
}
