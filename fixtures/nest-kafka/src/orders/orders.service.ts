import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

import { EVENTS, LEGACY_TOPIC, SharedTopics } from '@fixture/events';

import type {
  Order,
  OrderArchivedEvent,
  OrderCreatedEvent,
  OrderPaidEvent,
  OrderQuery,
  OrderShippedEvent,
} from './order.dto';
import { TelemetryService } from './telemetry.service';
import { COMPUTED_TOPIC, REGION_TOPIC, Topics } from './topics';

/**
 * Every producer in the fixture. The receiver is a `ClientProxy` injected under
 * a token, which is the shape the `nestjs-kafka` adapter reads; the four
 * resolution steps (literal, const/enum, `config.get`, dynamic) are exercised in
 * that order below.
 */
@Injectable()
export class OrdersService {
  constructor(
    @Inject('KAFKA_CLIENT') private readonly client: ClientProxy,
    private readonly config: ConfigService,
    private readonly telemetry: TelemetryService,
  ) {}

  // Step 1, a string literal. producer #1 for `channel:order.created`.
  create(dto: OrderCreatedEvent): void {
    this.client.emit('order.created', dto);
  }

  // The same channel from a second method: still one `channel:order.created`
  // node, a second `producer` and a second `emits` edge (§10, "same channel
  // emitted from 3 methods in one repo").
  replay(dto: OrderCreatedEvent): void {
    this.client.emit('order.created', dto);
  }

  // Producer #3 for the same channel, and the callback row: the call sits in an
  // arrow passed to `.then()`, so it is attributed to `importAll` — the nearest
  // enclosing method declaration — and never to the arrow.
  importAll(rows: OrderCreatedEvent[]): void {
    void Promise.resolve(rows).then((loaded) => {
      for (const row of loaded) {
        this.client.emit('order.created', row);
      }
    });
  }

  // Step 2, an enum member declared in this repo.
  // Expected: `channel:order.paid`, static, `meta.channelVia: "enum"`.
  markPaid(dto: OrderPaidEvent): void {
    this.client.emit(Topics.ORDER_PAID, dto);
  }

  // Step 2 across a package boundary: a const object imported from
  // `@fixture/events`, which the repo lists in `sharedPackages`.
  // Expected: `channel:order.shipped`, static, `meta.channelVia: "shared-package"`.
  ship(dto: OrderShippedEvent): void {
    this.client.emit(EVENTS.orderShipped, dto);
  }

  // The same step through the other declaration form, a string enum in the
  // shared package. Expected: `channel:order.archived`, static, "shared-package".
  archive(dto: OrderArchivedEvent): void {
    this.client.emit(SharedTopics.OrderArchived, dto);
  }

  // A const whose initializer is computed from one other const, which does have
  // a literal. Expected: `channel:order.computed`, static.
  sync(dto: OrderCreatedEvent): void {
    this.client.emit(COMPUTED_TOPIC, dto);
  }

  // The same form with a call in the hole: nothing survives one level of
  // following. Expected: unresolved `channel-const-unresolved`, hint naming
  // `REGION_TOPIC`.
  emitRegional(dto: OrderCreatedEvent): void {
    this.client.emit(REGION_TOPIC, dto);
  }

  // A shared-package const annotated `: string`, so the declaration carries no
  // literal either. Expected: unresolved `channel-const-unresolved`.
  emitLegacy(dto: OrderCreatedEvent): void {
    this.client.emit(LEGACY_TOPIC, dto);
  }

  // Step 3, the channel comes from configuration. No `channel` node; the
  // `producer` is kept with `meta.channelVia: "config"`.
  // Expected: unresolved `channel-from-config`, hint
  // "add @Emits('<topic>') on `OrdersService.emitConfigured`".
  emitConfigured(dto: OrderCreatedEvent): void {
    this.client.emit(this.config.get('ORDER_TOPIC'), dto);
  }

  // Step 4, a plain parameter. Expected: unresolved `channel-dynamic`, same hint.
  emitDynamic(topic: string, dto: OrderCreatedEvent): void {
    this.client.emit(topic, dto);
  }

  // Step 4 through spread arguments: there is no first argument node to read at
  // all. Expected: unresolved `channel-dynamic`, and above all no crash.
  emitSpread(...args: [string, OrderCreatedEvent]): void {
    this.client.emit(...args);
  }

  // `send` rather than `emit`: `meta.kind: "rpc"`. The return type is the type
  // argument of the call, unwrapped from `Observable<Order>` by `firstValueFrom`.
  // Expected: `returns: type:nest-kafka#Order`.
  getOrder(query: OrderQuery): Promise<Order> {
    return firstValueFrom(this.client.send<Order, OrderQuery>('get.order', query));
  }

  // An rpc whose result is never given a type: the producer still exists, the
  // return does not. Expected: unresolved `rpc-return-type-unknown`.
  getAnything(query: OrderQuery): unknown {
    return this.client.send('get.order.raw', query);
  }

  // The receiver is a local service, not a broker client. Nothing is emitted:
  // this is an ordinary call edge owned by P01, and the `emit` method name must
  // not be enough to make it a producer.
  track(dto: OrderCreatedEvent): void {
    this.telemetry.emit('order.created', { orderId: dto.orderId });
  }
}
