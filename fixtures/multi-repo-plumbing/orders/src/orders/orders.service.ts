import { Injectable } from '@nestjs/common';

import { AppLogger } from '../common/app-logger';
import { Metrics } from '../common/metrics';
import type { CreateOrderDto, OrderDto } from './order.dto';
import type { Order } from './order.entity';
import { OrderEvents } from './order.events';
import { OrderMapper } from './order.mapper';
import { OrderRepository } from './order.repository';

/** Every method logs, counts, reads through the repository and maps the row. */
@Injectable()
export class OrdersService {
  constructor(
    private readonly repository: OrderRepository,
    private readonly mapper: OrderMapper,
    private readonly events: OrderEvents,
    private readonly logger: AppLogger,
    private readonly metrics: Metrics,
  ) {}

  async findOne(id: string): Promise<OrderDto> {
    this.logger.log(`find ${id}`, 'OrdersService');
    this.metrics.count('orders.find');
    return this.mapper.toDto(await this.repository.findOne(id));
  }

  async create(body: CreateOrderDto): Promise<OrderDto> {
    this.logger.log(`create for ${body.customerId}`, 'OrdersService');
    this.metrics.count('orders.create');
    const row = await this.repository.save({ id: '', customerId: body.customerId, status: 'created', total: body.total } as Order);
    const order = this.mapper.toDto(await this.repository.findOne(row.id));
    this.events.created(order);
    return order;
  }

  async archive(id: string): Promise<OrderDto> {
    this.logger.log(`archive ${id}`, 'OrdersService');
    this.metrics.count('orders.archive');
    const row = await this.repository.findOne(id);
    return this.mapper.toDto(await this.repository.save({ ...row, status: 'archived' }));
  }

  async cancel(id: string): Promise<OrderDto> {
    this.logger.log(`cancel ${id}`, 'OrdersService');
    this.metrics.count('orders.cancel');
    const row = await this.repository.findOne(id);
    return this.mapper.toDto(await this.repository.save({ ...row, status: 'cancelled' }));
  }
}
