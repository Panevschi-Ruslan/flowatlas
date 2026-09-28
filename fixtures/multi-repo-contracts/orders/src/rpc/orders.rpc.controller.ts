import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';

import type { GetOrderQuery, OrderDto } from '../orders/dto';

/**
 * The question this service answers over a channel rather than a route.
 *
 * `billing` asks it with a shape of its own and reads the answer as one too,
 * so both directions of the rpc pair are worth checking: the payload, and the
 * `OrderDto` answered here against the one `billing` expects back (R151).
 */
@Controller()
export class OrdersRpcController {
  @MessagePattern('orders.get')
  get(@Payload() query: GetOrderQuery): Promise<OrderDto> {
    return Promise.resolve({ id: query.orderId, total: 0, placedAt: new Date() });
  }
}
