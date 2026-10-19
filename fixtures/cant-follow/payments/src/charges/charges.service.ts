import { Injectable } from '@nestjs/common';
import { LedgerClient, type LedgerEntry } from '@shopkit/ledger';

@Injectable()
export class ChargesService {
  private readonly ledger = new LedgerClient();

  async create(amount: number): Promise<LedgerEntry> {
    await this.ledger.reserve(amount);
    return this.ledger.post({ amount });
  }
}
