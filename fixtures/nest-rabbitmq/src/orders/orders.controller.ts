import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';

import type { OrderCancelledEvent } from './order.dto';

/**
 * The `ClientProxy` side of the repo consumes its own `order.cancelled` events.
 * This handler is a P01 entry (`entry:nest-rabbitmq:event:order.cancelled`), so
 * the consumer P04 adds beside it must carry that id in `meta.entryId` (§12).
 */
@Controller()
export class OrdersController {
  @EventPattern('order.cancelled')
  onOrderCancelled(@Payload() event: OrderCancelledEvent): void {
    void event.reason;
  }
}
