import { Injectable } from '@nestjs/common';

/**
 * A decoy: its name holds "cancellation", which stems as "cancelled" does,
 * but no word for an order. A sentence about cancelling an order ranks it
 * below every name holding both words.
 */
@Injectable()
export class CancellationTokens {
  issue(key: string): string {
    return `${key}-token`;
  }
}
