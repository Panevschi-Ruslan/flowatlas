import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

/** The call back into `gateway`, rooted at `GATEWAY_URL`. Closes the cycle. */
@Injectable()
export class AccountsClient {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  enrich(customerId: string, rows: unknown): { data: unknown } {
    return this.http.get(`${this.config.get('GATEWAY_URL')}/accounts/${customerId}`, { rows });
  }
}
