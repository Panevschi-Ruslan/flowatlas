import type { BasketItem } from '../lib/basket-store';
import request from '../lib/request';

const basePath = '/api';

/**
 * The browser's calls, as methods of the object a function hands back. Each
 * writes the address under `url` and the verb under `method`, or leaves the
 * verb to the default `request` writes.
 */
const Api = () => ({
  getBasket(sessionId: string) {
    return request<BasketItem[]>({ url: `${basePath}/basket`, queryParams: { sessionId } });
  },
  addToBasket(sessionId: string, item: BasketItem) {
    return request<BasketItem[]>({ url: `${basePath}/basket`, method: 'POST', body: { item }, queryParams: { sessionId } });
  },
  emptyBasket(sessionId: string) {
    return request<void>({ url: `${basePath}/basket`, method: 'DELETE', queryParams: { sessionId } });
  },
  placeOrder(sessionId: string) {
    return request<{ placed: boolean }>({ url: `${basePath}/checkout`, method: 'POST', queryParams: { sessionId } });
  },
  listProducts() {
    return request<Array<{ id: string; name: string }>>({ url: `${basePath}/catalog` });
  },
  listStores() {
    return request<Array<{ id: string; city: string }>>({ url: `${basePath}/stores` });
  },
});

export default Api();
