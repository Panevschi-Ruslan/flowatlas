import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';

import type { GetOrderQuery, OrderDto } from '../orders/dto';

/**
 * The question this service answers over a channel rather than a route.
 *
 * `billing` asks it with a shape of its own, which is what makes the payload
 * direction of an rpc pair worth checking. The answer is not checked: nothing
 * records what the asking side expects back (see §15).
 */
@Controller()
export class OrdersRpcController {
  @MessagePattern('orders.get')
  get(@Payload() query: GetOrderQuery): Promise<OrderDto> {
    return Promise.resolve({ id: query.orderId, total: 0, placedAt: new Date() });
  }
}
