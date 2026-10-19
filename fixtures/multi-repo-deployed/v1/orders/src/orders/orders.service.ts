import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';

import type { CreateOrderDto, OrderDto, OrderPlacedEvent } from '../dto/order.dto';

@Injectable()
export class OrdersService {
  constructor(@Inject('EVENTS_CLIENT') private readonly events: ClientProxy) {}

  async create(body: CreateOrderDto): Promise<OrderDto> {
    const order: OrderDto = { id: '1', bookId: body.bookId, status: 'placed' };
    const event: OrderPlacedEvent = { orderId: order.id, customerId: 'c-1' };
    this.events.emit('order.placed', event);
    return order;
  }

  async findOne(id: string): Promise<OrderDto> {
    return { id, bookId: '', status: 'placed' };
  }
}
