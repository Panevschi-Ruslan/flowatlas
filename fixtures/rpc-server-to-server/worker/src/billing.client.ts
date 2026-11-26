import { Injectable } from '@nestjs/common';
import { createTRPCClient, createWSClient, httpBatchLink, loggerLink, splitLink, wsLink } from '@trpc/client';

/**
 * The billing service's tRPC client, made in the constructor. Its address is
 * a host, billing.internal, which the configuration says billing is reached
 * at. Subscriptions go over the socket branch of the split, whose address is
 * the WebSocket client's and is not read.
 */
@Injectable()
export class BillingClient {
  private readonly billing: any;

  constructor() {
    this.billing = createTRPCClient<any>({
      links: [
        loggerLink(),
        splitLink({
          condition: (op) => op.type === 'subscription',
          true: wsLink({ client: createWSClient({ url: 'ws://billing.internal/trpc' }) }),
          false: httpBatchLink({ url: 'http://billing.internal/trpc' }),
        }),
      ],
    });
  }

  invoice(orderId: string) {
    return this.billing.invoices.create.mutate({ orderId });
  }

  invoicesOf(orderId: string) {
    return this.billing.invoices.byOrder.query({ orderId });
  }

  watchPaid(onPaid: (invoice: unknown) => void) {
    return this.billing.invoices.paid.subscribe(undefined, { onData: onPaid });
  }
}
