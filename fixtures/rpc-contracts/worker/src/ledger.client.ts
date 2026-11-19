import { Injectable } from '@nestjs/common';
import { createTRPCClient, httpLink } from '@trpc/client';

/**
 * The ledger client sends to `/trpc`, the path tRPC's own examples use; the
 * ledger's standalone server answers under `/api`, so nothing answers there.
 */
@Injectable()
export class LedgerClient {
  private readonly ledger = createTRPCClient<any>({ links: [httpLink({ url: `${process.env.LEDGER_URL}/trpc` })] });

  record(orderId: string, amount: number) {
    return this.ledger.entries.record.mutate({ orderId, amount });
  }
}
