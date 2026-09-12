import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';

import type { CreateOrderDto, OrderCreatedEvent, OrderDto } from '../dto/create-order.dto';

/**
 * The method the whole fixture is about.
 *
 * Two buttons in a browser, one bot press and one channel handler in another
 * repository all end up here, and none of the four is in this repository. That
 * is what a blast radius is for.
 */
@Injectable()
export class OrdersService {
  constructor(@Inject('EVENTS_CLIENT') private readonly events: ClientProxy) {}

  async create(body: CreateOrderDto): Promise<OrderDto> {
    const order: OrderDto = { id: '1', customerId: body.customerId, status: 'created' };
    const event: OrderCreatedEvent = { orderId: order.id, customerId: order.customerId };
    this.events.emit('order.created', event);
    return order;
  }

  async findOne(id: string): Promise<OrderDto> {
    return { id, customerId: '', status: 'created' };
  }

  /**
   * Gone in the head revision.
   *
   * Nothing outside this class calls it, so its removal is a node that
   * disappears with an impact row of its own — computed on the base graph,
   * because the head graph has nothing to walk.
   */
  async legacy(id: string): Promise<OrderDto> {
    return this.findOne(id);
  }
}
