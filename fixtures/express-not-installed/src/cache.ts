import { LRUCache } from 'lru-cache';

/**
 * Also uninstalled, and also called with a `get` of two arguments. Nothing in
 * the source states that it is an application, so nothing here is a route.
 */
const cache = new LRUCache<string, string>({ max: 10 });

export const cached = (key: string): string | undefined => cache.get(key, { allowStale: true });
