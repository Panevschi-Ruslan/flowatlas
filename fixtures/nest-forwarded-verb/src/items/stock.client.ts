import { Injectable } from '@nestjs/common';

/**
 * A client handed the verb as well as the path (P91): `{ method }` is the
 * caller's, so each caller's request carries the verb it hands in. A caller
 * that hands in something nothing can read keeps the request with its verb
 * unread.
 */
@Injectable()
export class StockClient {
  async call(method: string, path: string): Promise<void> {
    await fetch(`https://api.example.com${path}`, { method });
  }

  /** The body is a parameter too (P128): each caller's request carries the one it hands in. */
  async send(method: string, path: string, body: unknown): Promise<void> {
    await fetch(`https://api.example.com${path}`, { method, body: JSON.stringify(body) });
  }
}

@Injectable()
export class Restocker {
  constructor(private readonly stock: StockClient) {}

  async restock(id: string): Promise<void> {
    await this.stock.call('PATCH', `/items/${id}/stock`);
  }

  async reserve(id: string, count: number): Promise<void> {
    await this.stock.send('POST', '/items/reservations', { id, count });
  }

  async settle(final: boolean): Promise<void> {
    await this.stock.call(final ? 'PUT' : 'POST', '/items/settlement');
  }
}
