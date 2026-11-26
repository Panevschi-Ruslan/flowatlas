import { Injectable, inject } from '@angular/core';
import { billing, TRPC } from './trpc';

/** The portal's calls to billing, through the module's client and the injected one. */
@Injectable({ providedIn: 'root' })
export class InvoicesService {
  private readonly trpc = inject(TRPC);

  /** Through the client provided for TRPC. */
  invoicesOf(orderId: string) {
    return this.trpc.invoices.byOrder.query({ orderId });
  }

  /** Through the module's own client. */
  invoice(orderId: string) {
    return billing.invoices.create.mutate({ orderId });
  }
}
