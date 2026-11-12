import { Inject, Injectable } from '@nestjs/common';
import type { UntypedClient } from '@trpc/client';
import { BILLING_CLIENT, BILLING_UNTYPED } from './billing.module';

/**
 * Calls billing through the clients its module provides for two tokens.
 * The typed one is typed `any`: billing's tree is not installed here, so the
 * input is the literal written and the answer has no type.
 */
@Injectable()
export class BillingService {
  constructor(
    @Inject(BILLING_CLIENT) private readonly billing: any,
    @Inject(BILLING_UNTYPED) private readonly untyped: UntypedClient,
  ) {}

  invoice(orderId: string) {
    return this.billing.invoices.create.mutate({ orderId });
  }

  /** Drifted: billing's `byOrder` takes an `orderId`. */
  invoicesOf(orderId: string) {
    return this.billing.invoices.byOrder.query({ order: orderId });
  }

  /** The untyped client names the path as text. */
  void(invoiceId: string) {
    return this.untyped.mutation('invoices.void', { invoiceId });
  }
}
