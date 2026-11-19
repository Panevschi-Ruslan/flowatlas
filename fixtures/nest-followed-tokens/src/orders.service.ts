import { Inject, Injectable } from '@nestjs/common';
import { getConfigToken, type ConfigType } from '@nestjs/config';
import appConfig from './app.config';
import { AuditClient } from './clients/audit.client';
import { AUDIT_CLIENT, LEDGER_CLIENT } from './clients/clients.module';
import { mailConfig, reportsConfig } from './mail.config';

/** Places orders, with the shop's settings and its clients. */
@Injectable()
export class OrdersService {
  constructor(
    @Inject(appConfig.KEY) private readonly app: ConfigType<typeof appConfig>,
    @Inject(getConfigToken('mail')) private readonly mail: ConfigType<typeof mailConfig>,
    @Inject(reportsConfig.KEY) private readonly reports: ConfigType<typeof reportsConfig>,
    @Inject(LEDGER_CLIENT) private readonly ledger: { url: string },
    @Inject(AUDIT_CLIENT) private readonly audit: AuditClient,
  ) {}

  place(orderId: string): string {
    this.audit.record(orderId);
    return `${orderId} in ${this.app.currency} from ${this.mail.from} to ${this.ledger.url}`;
  }
}
