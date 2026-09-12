import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

/** Requests whose address comes from a setting, which is what makes them leaves. */
@Injectable()
export class BillingClient {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  charge(orderId: string): { data: unknown } {
    return this.http.post(`${this.config.get('BILLING_URL')}/invoices`, { orderId });
  }

  refund(orderId: string): { data: unknown } {
    return this.http.post(`${this.config.get('BILLING_URL')}/refunds`, { orderId });
  }
}
