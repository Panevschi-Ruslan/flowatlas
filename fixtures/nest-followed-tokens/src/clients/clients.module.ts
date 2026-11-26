import { Module } from '@nestjs/common';
import { AuditClient } from './audit.client';

export const LEDGER = 'LEDGER';
export const LEDGER_CLIENT = 'LEDGER_CLIENT';
export const AUDIT_CLIENT = 'AUDIT_CLIENT';

/**
 * The shop's clients. The ledger is made by a factory and handed on under a
 * second token; the audit client is a class, handed on under a token.
 */
@Module({})
export class ClientsModule {
  static forRoot() {
    return {
      module: ClientsModule,
      providers: [
        AuditClient,
        { provide: LEDGER, useFactory: () => ({ url: 'http://ledger.internal' }) },
        { provide: LEDGER_CLIENT, useExisting: LEDGER },
        { provide: AUDIT_CLIENT, useExisting: AuditClient },
      ],
      exports: [LEDGER_CLIENT, AUDIT_CLIENT],
    };
  }
}
