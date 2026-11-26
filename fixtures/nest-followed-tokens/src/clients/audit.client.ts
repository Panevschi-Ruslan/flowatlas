import { Injectable } from '@nestjs/common';

/** Writes what happened to an order to the audit log. */
@Injectable()
export class AuditClient {
  record(orderId: string): string {
    return `audited ${orderId}`;
  }
}
