import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

/** `BILLING_URL`, read on the `POST /orders` flow and reported under `orders`. */
@Injectable()
export class BillingClient {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  requestInvoice(orderId: string): { data: unknown } {
    return this.http.post(`${this.config.get('BILLING_URL')}/invoices`, { orderId });
  }
}
