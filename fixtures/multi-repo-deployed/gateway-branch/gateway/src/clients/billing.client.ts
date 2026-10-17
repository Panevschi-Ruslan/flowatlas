import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

import type { CreateInvoiceDto } from './dto';

/** New on this branch: tied to `billing` through `BILLING_URL`. */
@Injectable()
export class BillingClient {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  invoice(body: CreateInvoiceDto) {
    return this.http.post(`${this.config.get('BILLING_URL')}/invoices`, body);
  }
}
