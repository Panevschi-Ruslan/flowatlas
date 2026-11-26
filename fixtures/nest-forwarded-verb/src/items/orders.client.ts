import { Injectable } from '@nestjs/common';

/**
 * A client whose verb is a member of the options its callers hand in, with a
 * default where they hand none (R179): `options?.method ?? 'POST'`, then the
 * caller's options spread over the request's own.
 */
@Injectable()
export class OrdersClient {
  async request(path: string, options?: RequestInit): Promise<void> {
    const method = options?.method ?? 'POST';
    await fetch(`https://api.example.com${path}`, { method, ...options });
  }
}

@Injectable()
export class Ordering {
  constructor(private readonly orders: OrdersClient) {}

  async place(): Promise<void> {
    await this.orders.request('/orders');
  }

  async cancel(id: string): Promise<void> {
    await this.orders.request(`/orders/${id}`, { method: 'DELETE' });
  }
}
