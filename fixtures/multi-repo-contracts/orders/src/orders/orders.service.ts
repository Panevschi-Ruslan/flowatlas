import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import type { MoneyDto } from '@fx/wire';

import type { AddressDto, CreateOrderDto, OrderCreatedEvent, OrderDto } from './dto';

/** Answers the routes and publishes the one event the fixture pairs up. */
@Injectable()
export class OrdersService {
  constructor(
    @Inject('EVENTS_CLIENT')
    private readonly events: ClientProxy,
  ) {}

  async findOne(id: string): Promise<OrderDto> {
    return { id, total: 0, placedAt: new Date() };
  }

  async price(body: MoneyDto): Promise<MoneyDto> {
    return body;
  }

  async address(body: AddressDto): Promise<AddressDto> {
    return body;
  }

  /**
   * The publisher of `order.created`.
   *
   * `billing` handles the same channel with a shape of its own, so the payload
   * direction of that pair is where a channel contract is checked.
   */
  async create(body: CreateOrderDto): Promise<OrderDto> {
    const event: OrderCreatedEvent = {
      orderId: body.customerId,
      total: body.total,
      placedAt: new Date(),
    };
    this.events.emit('order.created', event);
    return { id: body.customerId, total: body.total.amount, placedAt: event.placedAt };
  }
}
