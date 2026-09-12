import { Module } from '@nestjs/common';

import { RedisCache } from './redis-cache';

@Module({
  providers: [
    // 'STORE' is also provided by CacheModule, there with MemoryCache.
    { provide: 'STORE', useClass: RedisCache },
  ],
  exports: ['STORE'],
})
export class AltCacheModule {}
