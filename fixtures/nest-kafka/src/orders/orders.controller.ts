import { Controller } from '@nestjs/common';
import { Ctx, EventPattern, KafkaContext, MessagePattern, Payload } from '@nestjs/microservices';
import type { EachMessagePayload } from 'kafkajs';

import type { Order, OrderCreatedEvent, OrderPaidEvent, OrderQuery } from './order.dto';
import { Topics } from './topics';

/**
 * Every consumer in the fixture. Each `@EventPattern` / `@MessagePattern`
 * handler is already a P01 `entry`; P04 adds a `consumer` beside it whose
 * `meta.entryId` points back at that entry (D1), so the ids must line up:
 * `entry:nest-kafka:event:<pattern>` and `entry:nest-kafka:rpc:<pattern>`.
 */
@Controller()
export class OrdersController {
  // Consumer of the channel this repo also produces: the literal pattern gives
  // `channel:order.created`, the same id the producers use.
  @EventPattern('order.created')
  onOrderCreated(@Payload() event: OrderCreatedEvent): void {
    void event.orderId;
  }

  // The pattern is an enum member, so the consumer side needs the same
  // declaration-following as the producer side. Expected: `channel:order.paid`.
  @EventPattern(Topics.ORDER_PAID)
  onOrderPaid(@Payload() event: OrderPaidEvent): void {
    void event.paidAt;
  }

  // An object pattern: the channel name is the stable JSON of the object,
  // `{"cmd":"order.sync"}`, reusing P01's `meta.pattern` verbatim.
  @EventPattern({ cmd: 'order.sync' })
  onOrderSync(@Payload() event: OrderCreatedEvent): void {
    void event.orderId;
  }

  // A decorator with no arguments at all. Expected: unresolved
  // `channel-dynamic`, and above all no crash (§10, last row).
  @EventPattern()
  onAnything(@Payload() event: unknown): void {
    void event;
  }

  // The raw kafkajs message shape, which is what a Kafka consumer really
  // receives underneath the Nest context. It is a parameter type only, never a
  // call receiver, so it adds no node.
  @EventPattern('order.audit')
  onAudit(@Payload() event: OrderCreatedEvent, @Ctx() context: KafkaContext): void {
    void event;
    void context.getTopic();
  }

  // rpc with a declared return type. Expected: `handles` edge carrying
  // `returns: type:nest-kafka#Order` (§12, the rpc half).
  @MessagePattern('get.order')
  async getOrder(@Payload() query: OrderQuery): Promise<Order> {
    return { id: query.orderId, customerId: 'c-1', status: 'created', total: 0 };
  }

  // rpc whose handler returns `any`. The consumer still exists; the return does
  // not. Expected: unresolved `rpc-return-type-unknown`.
  @MessagePattern('get.order.raw')
  getOrderRaw(@Payload() query: OrderQuery): any {
    return { id: query.orderId };
  }
}

/** Used for its type only, to keep the raw kafkajs shape in the fixture. */
export const rawTopicOf = (payload: EachMessagePayload): string => payload.topic;
