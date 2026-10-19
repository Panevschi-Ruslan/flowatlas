import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

import { AppLogger } from '../common/app-logger';
import { Metrics } from '../common/metrics';

/** The calls into `orders`. */
@Injectable()
export class OrdersClient {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly logger: AppLogger,
    private readonly metrics: Metrics,
  ) {}

  fetchOne(id: string) {
    this.logger.log(`fetch ${id}`, 'OrdersClient');
    this.metrics.count('orders.fetch');
    return this.http.get(`${this.config.get('ORDERS_URL')}/orders/${id}`);
  }

  cancel(id: string) {
    this.logger.log(`cancel ${id}`, 'OrdersClient');
    this.metrics.count('orders.cancel');
    return this.http.post(`${this.config.get('ORDERS_URL')}/orders/${id}/cancel`, {});
  }
}
