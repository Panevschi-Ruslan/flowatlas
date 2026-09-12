import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Redis } from 'ioredis';
import type { OrderDto } from './order.dto.js';

@Injectable()
export class OrdersService {
  private readonly cache = new Redis();

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  // A literal key: the pattern is the key itself.
  warm(): Promise<string | null> {
    return this.cache.get('orders:index');
  }

  // A key with a literal prefix: the pattern keeps the prefix and marks the hole.
  byId(id: string): Promise<string | null> {
    return this.cache.get(`orders:${id}`);
  }

  put(id: string, value: string): Promise<'OK'> {
    return this.cache.set(`orders:${id}`, value);
  }

  drop(id: string): Promise<number> {
    return this.cache.del(`orders:${id}`);
  }

  // No literal part at all, so there is no pattern to record.
  // Expected: dynamic-cache-key.
  dropComputed(key: string): Promise<number> {
    return this.cache.del(key);
  }

  // Rooted at a configuration key, which is what lets this call be matched to
  // another service's route later.
  fetchOne(id: string): { data: unknown } {
    return this.http.get<OrderDto>(`${this.config.get('ORDERS_URL')}/orders/${id}`);
  }

  // Same, with a body.
  create(body: OrderDto): { data: unknown } {
    return this.http.post<OrderDto>(`${this.config.get('ORDERS_URL')}/orders`, body);
  }

  // An address naming a third party outright.
  charge(): Promise<unknown> {
    return axios.post('https://api.stripe.com/v1/charges', { amount: 100 });
  }

  // Built at run time, so nothing can be recorded.
  // Expected: dynamic-http-url.
  callAnything(url: string): Promise<unknown> {
    return axios.get(url);
  }

  // The platform's own request function, with the method in the options.
  ping(): Promise<Response> {
    return fetch('https://example.test/health', { method: 'HEAD' });
  }

  // Three ways of reading configuration, all recorded.
  settings(): unknown {
    const a = this.config.get('FEATURE_X');
    const b = this.config.get('TIMEOUT_MS', '5000');
    const c = process.env.NODE_ENV;
    return { a, b, c };
  }

  // The key itself is computed, so nothing is recorded.
  // Expected: dynamic-config-key.
  dynamicSetting(name: string): unknown {
    return this.config.get(name);
  }
}
