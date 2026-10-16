import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Every request the shop makes, each rooted at a setting no service claims
 * under `baseUrlEnv`. What each one is joined by is what the repositories'
 * own files say the setting is (P77); the README lists them.
 */
@Injectable()
export class ShopClient {
  constructor(private readonly config: ConfigService) {}

  /** `ORDERS_API` is `http://orders:3000` in `.env.example`: the service called `orders`. */
  order(id: string) {
    return fetch(`${this.config.get('ORDERS_API')}/orders/${id}`);
  }

  /**
   * `ORDERS_SERVICE_URL` is set in `.env` only, whose values are never read;
   * the setting is named after `orders`, the one service it can be.
   */
  history(id: string) {
    return fetch(`${process.env.ORDERS_SERVICE_URL}/orders/${id}`);
  }

  /** `PAYMENTS_BASE` is the container `payments-api` in `docker-compose.yml`, built from `payments`. */
  pay(id: string) {
    return fetch(`${process.env.PAYMENTS_BASE}/payments`, { method: 'POST', body: JSON.stringify({ id }) });
  }

  /** Nothing sets `LEDGER_URL`; the code falls back to the port `payments-api` publishes. */
  refund(id: string) {
    return fetch(`${process.env.LEDGER_URL ?? 'http://localhost:4000'}/refunds`, { method: 'POST', body: JSON.stringify({ id }) });
  }

  /** `SHIPPING_URL` is a host outside the project: a third party. */
  rates() {
    return fetch(`${this.config.get('SHIPPING_URL')}/rates`);
  }

  /** `INVENTORY_URL` is set in `.env` only, and is named after nothing configured: a row. */
  stock() {
    return fetch(`${process.env.INVENTORY_URL}/stock`);
  }

  /** `catalog.url` is `CATALOG_URL`, falling back to `http://catalog:3002`, in `catalog.config.ts`. */
  products() {
    return fetch(`${this.config.get('catalog.url')}/products`);
  }
}
