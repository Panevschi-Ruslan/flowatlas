import { Injectable } from '@nestjs/common';
import { FlagClient, isOn } from '@acme/feature-flags';
import { formatAmount, Money } from '@acme/money';
import { QueueClient } from '@acme/queue-client';

export interface LoanRequest {
  memberId: string;
  bookId: string;
  deposit: number;
}

@Injectable()
export class LoansService {
  private readonly queue = new QueueClient();
  private readonly flags = new FlagClient();

  async approve(request: LoanRequest): Promise<string> {
    const deposit = new Money(request.deposit, 'EUR');
    if (isOn('fast-approval')) {
      await this.queue.connect();
      await this.queue.publish('loan.approved', { memberId: request.memberId, bookId: request.bookId });
    }
    return deposit.format();
  }

  fee(id: string): string {
    const plan = this.flags.variant('fee-plan');
    return formatAmount(plan.amount, id);
  }
}
