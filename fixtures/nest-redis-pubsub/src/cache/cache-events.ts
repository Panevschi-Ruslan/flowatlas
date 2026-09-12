/** Payload shapes carried on the redis channels. */

export interface CacheInvalidated {
  entity: string;
  id: string;
  at: string;
}

export interface CacheWarmed {
  entity: string;
  count: number;
}

/** Channel names declared in this repo. */
export const CACHE_CHANNELS = {
  invalidate: 'cache.invalidate',
  warm: 'cache.warm',
} as const;
