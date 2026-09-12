import { Injectable, Logger } from '@nestjs/common';
import { Observable, of } from 'rxjs';

import { SharedOrderEvent } from '@fixture/contracts';

// unresolved: type-unresolved — `@acme/legacy-orders` is not installed, so this
// import resolves to an error type. `LegacyOrder` must become `unknown` with no
// registry entry and no guessed shape (I3); hint: "install deps or fix tsconfig paths".
import { LegacyOrder } from '@acme/legacy-orders';

import { Order, Status } from '../types/order';
import { Paginated } from '../types/paginated';
import { CreateOrderDto } from './dto/create-order.dto';
import { ListQuery } from './dto/list-query.dto';

@Injectable()
export class OrdersService {
  /** `Promise<Paginated<Order>>` → `returns: 'type:nest-types#Paginated<type:nest-types#Order>'` (D6). */
  async list(query: ListQuery): Promise<Paginated<Order>> {
    return { items: [], total: 0, page: query.limit ? 1 : 0 };
  }

  /** `Observable<Order[]>` → `returns: 'type:nest-types#Order[]'` (Observable unwrapped, D8). */
  stream(): Observable<Order[]> {
    return of([]);
  }

  async findOne(id: string): Promise<Order> {
    return this.stub(id);
  }

  async create(dto: CreateOrderDto): Promise<Order> {
    return this.stub(dto.customerId);
  }

  /** `Partial<Order>` param: a mapped utility with apparent properties → inlined `{…}` (§10). */
  async update(id: string, patch: Partial<Order>): Promise<Order> {
    return Object.assign(this.stub(id), patch);
  }

  /** `Promise<void>` → `returns: 'void'` (D8). */
  async cancel(id: string, reason: string): Promise<void> {
    this.logTo(new Logger(reason), await this.findOne(id));
  }

  /** Shared-package type → id `type:@fixture/contracts#SharedOrderEvent`, collected in full (D7). */
  toEvent(order: Order): SharedOrderEvent {
    return {
      orderId: order.id,
      customerId: order.customerId,
      status: 'created',
      total: { amount: 0, currency: 'EUR' },
      occurredAt: order.createdAt.toISOString(),
    };
  }

  /** `LegacyOrder` comes from the unresolvable import above → `unknown` + `type-unresolved`. */
  fromLegacy(legacy: LegacyOrder): Order {
    return this.stub(legacy.id);
  }

  /** `Logger` is declared in `node_modules` and is not a shared package → `kind: external`, no fields (D7). */
  logTo(logger: Logger, order: Order): void {
    logger.log(order.id);
  }

  private stub(id: string): Order {
    return {
      id,
      createdAt: new Date(),
      customerId: id,
      status: Status.New,
      kind: 'retail',
      lines: [],
    };
  }
}
