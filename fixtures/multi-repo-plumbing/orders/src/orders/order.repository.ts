import { Injectable } from '@nestjs/common';
import { InjectRepository, Repository } from 'typeorm';

import { AppLogger } from '../common/app-logger';
import { Metrics } from '../common/metrics';
import { Order } from './order.entity';

/**
 * The data layer every service method goes through. `findOne` is called from
 * each of them, so it is the shared helper a walk would otherwise expand once
 * per caller, with the logger and the counter under it each time.
 */
@Injectable()
export class OrderRepository {
  constructor(
    @InjectRepository(Order)
    private readonly rows: Repository<Order>,
    private readonly logger: AppLogger,
    private readonly metrics: Metrics,
  ) {}

  async findOne(id: string): Promise<Order> {
    this.metrics.count('orders.read');
    this.logger.log(`read ${id}`, 'OrderRepository');
    return this.rows.findOne({ where: { id } });
  }

  async save(row: Order): Promise<Order> {
    this.metrics.count('orders.write');
    this.logger.log(`write ${row.id}`, 'OrderRepository');
    return this.rows.save(row);
  }
}
