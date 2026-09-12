import { Module } from '@nestjs/common';

import { MemoryCache } from './memory-cache';

@Module({
  providers: [
    MemoryCache,
    // useClass: resolves to a class declared in this repo -> static `injects` edge.
    { provide: 'CACHE', useClass: MemoryCache },
    // useExisting: an alias that must be followed to the 'CACHE' provider above.
    { provide: 'CACHE_ALIAS', useExisting: 'CACHE' },
    // Same token as in AltCacheModule, different class -> the ambiguity below.
    { provide: 'STORE', useClass: MemoryCache },
  ],
  exports: [MemoryCache, 'CACHE', 'CACHE_ALIAS', 'STORE'],
})
export class CacheModule {}
