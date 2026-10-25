import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

import { AppLogger } from '../common/app-logger';
import { Metrics } from '../common/metrics';

/** The call into `billing`, behind the same logger and counter as everything else. */
@Injectable()
export class BillingClient {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly logger: AppLogger,
    private readonly metrics: Metrics,
  ) {}

  requestInvoice(orderId: string, amount: number) {
    this.logger.log(`invoice ${orderId}`, 'BillingClient');
    this.metrics.count('billing.invoice');
    return this.http.post(`${this.config.get('BILLING_URL')}/invoices`, { orderId, amount });
  }
}
