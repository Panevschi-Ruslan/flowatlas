import { useEffect } from 'react';

export interface ShopEvent {
  type: string;
  id: string;
}

/** The stream that relays both of the shop's channels; each caller hands in the function its frames go to. */
export function useShopStream(shopId: string, onEvent: (event: ShopEvent) => void): void {
  useEffect(() => {
    const source = new EventSource(`${import.meta.env.VITE_STORES_URL}/shops/${shopId}/stream`);
    source.onmessage = (frame) => onEvent(JSON.parse(frame.data) as ShopEvent);
    return () => source.close();
  }, [shopId]);
}

/** The feed: the orders channel and one the shop's settings name. */
export function useShopFeed(shopId: string, onEvent: (event: ShopEvent) => void): void {
  useEffect(() => {
    const source = new EventSource(`${import.meta.env.VITE_STORES_URL}/shops/${shopId}/feed`);
    source.onmessage = (frame) => onEvent(JSON.parse(frame.data) as ShopEvent);
    return () => source.close();
  }, [shopId]);
}
