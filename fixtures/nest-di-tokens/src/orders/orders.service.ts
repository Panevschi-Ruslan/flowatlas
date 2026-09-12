import { Inject, Injectable, forwardRef } from '@nestjs/common';

import { PaymentsService } from '../payments/payments.service';
import { AppConfig, CONFIG, Cache, Client } from '../tokens';

@Injectable()
export class OrdersService {
  constructor(
    // { provide: 'CACHE', useClass: MemoryCache } in CacheModule -> static edge.
    @Inject('CACHE') private readonly cache: Cache,
    // { provide: 'CACHE_ALIAS', useExisting: 'CACHE' } -> follow the alias, static edge.
    @Inject('CACHE_ALIAS') private readonly aliasCache: Cache,
    // unresolved: di-token-ambiguous — 'STORE' is provided by CacheModule (MemoryCache)
    // and by AltCacheModule (RedisCache); the two candidates differ.
    @Inject('STORE') private readonly store: Cache,
    // { provide: CONFIG, useValue: {...} } -> provider node kind `value`.
    @Inject(CONFIG) private readonly config: AppConfig,
    // { provide: 'CLIENT', useFactory: () => ... } -> provider node kind `factory`.
    @Inject('CLIENT') private readonly client: Client,
    // unresolved: di-token-unknown — 'METRICS' is not provided by any module in this repo.
    @Inject('METRICS') private readonly metrics: { inc(name: string): void },
    // forwardRef: one half of the OrdersService <-> PaymentsService cycle.
    @Inject(forwardRef(() => PaymentsService))
    private readonly payments: PaymentsService,
  ) {}

  describe(id: string): string {
    return `${this.config.baseUrl}/orders/${this.cache.get(id)}`;
  }

  place(id: string): string {
    this.metrics.inc('orders.place');
    // unresolved: call-through-token — `client` comes from a useFactory provider, so the
    // instance behind the token has no class declaration to point a `calls` edge at.
    this.client.send(id);
    void this.aliasCache.get(id);
    void this.store.get(id);
    return this.payments.charge(id);
  }
}
