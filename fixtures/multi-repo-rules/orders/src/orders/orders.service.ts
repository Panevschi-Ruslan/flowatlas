import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { InjectRepository, Repository } from 'typeorm';

import type { CreateOrderDto, OrderDto } from '@fx/contracts';

import { Order } from './order.entity';
import { toDto } from './order.mapper';

/** The data layer and the two producers. */
@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private readonly orders: Repository<Order>,
    @Inject('EVENTS_CLIENT')
    private readonly events: ClientProxy,
  ) {}

  /**
   * The far end of the cross-repo chain: `db_query` (`read`) on
   * `table:orders#Order`, reached from `entry:orders:http:GET:/orders/:param`,
   * which the gateway's linked `http_out` points at.
   */
  async findOne(id: string): Promise<OrderDto> {
    const row = await this.orders.findOne({ where: { id } });
    return toDto(row);
  }

  async latest(): Promise<OrderDto[]> {
    const rows = await this.orders.find({ take: 10 });
    return rows.map(toDto);
  }

  /**
   * The producer that stitches: `billing` has an `@EventPattern('order.created')`
   * handler, so one `channel:order.created` node ends up with one producer and
   * one consumer, in two repositories, and exists exactly once (§12).
   */
  async create(body: CreateOrderDto): Promise<OrderDto> {
    const row = await this.orders.save({
      id: '',
      customerId: body.customerId,
      status: 'created',
      total: body.total.amount,
      currency: body.total.currency,
    } as Order);
    const dto = toDto(row);
    this.events.emit('order.created', dto);
    return dto;
  }

  /**
   * Nothing anywhere in the project consumes `order.archived`.
   * Expected: `channels.noConsumers` contains `channel:order.archived` — a
   * report entry and never an unresolved, because a producer whose consumer
   * lives in a repository the configuration does not list yet is normal (D7).
   */
  async archive(id: string): Promise<void> {
    const row = await this.orders.findOne({ where: { id } });
    this.events.emit('order.archived', { orderId: row.id, archivedAt: '' });
  }
}
