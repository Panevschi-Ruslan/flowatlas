import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { CallsService, ContractIgnore } from '@flowatlas/markers';

import type { CreateOrderDto, OrderDto } from './dto';

/**
 * Six calls out of this service, and every way one can go wrong.
 *
 * Three build their address at run time and can only be placed by an
 * annotation; three write it out, and are placed or not placed by the settings
 * key at the front of it. Between them they cover both halves of what the
 * health check is for: an annotation that no longer matches the code, and a
 * route that moved while the caller was not looking.
 */
@Injectable()
export class OrdersClient {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  /**
   * The annotation doing its job: the address is assembled and the annotation
   * says where it lands. Expected: no marker issue, and an `http_calls` edge to
   * `POST /orders` at `marker` confidence.
   */
  @CallsService('orders', 'POST /orders')
  create(body: CreateOrderDto): { data: unknown } {
    return this.http.post<OrderDto>(this.endpoint('orders'), body);
  }

  /**
   * The annotation gone stale: `orders` serves no such route.
   * Expected: `marker-callsservice-route-missing`, an error.
   */
  @CallsService('orders', 'DELETE /orders/:id/void')
  cancel(id: string): { data: unknown } {
    return this.http.delete(this.endpoint(`orders/${id}/cancel`));
  }

  /**
   * The annotation naming a service the configuration does not list.
   * Expected: `marker-callsservice-unknown-service`, an error.
   */
  @CallsService('warehouse', 'POST /restock')
  restock(sku: string): { data: unknown } {
    return this.http.post(this.endpoint('restock'), { sku });
  }

  /**
   * The route that moved. The address is written out and the settings key names
   * `orders`, so this is placed without help — at a path `orders` does not
   * serve. Expected: a `desync` row, `target-route-not-found`.
   */
  void(id: string): { data: unknown } {
    return this.http.delete(`${this.config.get('ORDERS_URL')}/orders/${id}/void`);
  }

  /**
   * A settings key no service claims.
   * Expected: a `desync` row, `unknown-base-url-env`.
   */
  history(id: string): { data: unknown } {
    return this.http.get(`${this.config.get('LEGACY_URL')}/orders/${id}/history`);
  }

  /**
   * Drift the project has decided to live with, said out loud.
   *
   * The same `CreateOrderDto` as `create`, against the same declaration, so the
   * findings are the same ones — and every one of them is excused rather than
   * removed. Expected: `contracts.ignored` counts them and no error is raised.
   */
  @ContractIgnore()
  legacy(body: CreateOrderDto): { data: unknown } {
    return this.http.post<OrderDto>(`${this.config.get('ORDERS_URL')}/orders/legacy`, body);
  }

  /** What makes three of these addresses unreadable. */
  private endpoint(path: string): string {
    return `${this.config.get('GATEWAY_BASE')}/${path}`;
  }

  /**
   * One annotation naming two routes of one service (R38).
   *
   * A method that fans out reaches several routes, and saying so once has to
   * mean exactly what saying it twice means. Expected: two `http_calls` edges
   * at `marker` confidence, to `POST /orders` and `GET /orders/:param`, and no
   * marker issue.
   */
  @CallsService('orders', 'POST /orders', 'GET /orders/:id')
  replay(body: CreateOrderDto): { data: unknown } {
    return this.http.post<OrderDto>(this.endpoint('replay'), body);
  }

  /** The same, written as a list. It must not read differently. */
  @CallsService('orders', ['POST /orders/legacy'])
  replayLegacy(body: CreateOrderDto): { data: unknown } {
    return this.http.post<OrderDto>(this.endpoint('replay-legacy'), body);
  }
}
