import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';

import { AppLogger } from '../common/app-logger';
import { Metrics } from '../common/metrics';
import type { OrderDto } from './order.dto';

/**
 * Where the service publishes from. The event leaves three calls below the
 * route, behind the logger and the counter, which is what a walk that expands
 * every shared helper under every caller never gets to.
 */
@Injectable()
export class OrderEvents {
  constructor(
    @Inject('EVENTS_CLIENT')
    private readonly client: ClientProxy,
    private readonly logger: AppLogger,
    private readonly metrics: Metrics,
  ) {}

  created(order: OrderDto): void {
    this.logger.log(`publish order.created ${order.id}`, 'OrderEvents');
    this.metrics.count('orders.created');
    this.client.emit('order.created', order);
  }
}
