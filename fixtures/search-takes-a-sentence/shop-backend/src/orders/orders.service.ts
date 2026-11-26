import { Injectable } from '@nestjs/common';
import { CancellationTokens } from '../common/cancellation-tokens';
import { PaymentsService } from '../payments/payments.service';

@Injectable()
export class OrdersService {
  constructor(
    private readonly payments: PaymentsService,
    private readonly tokens: CancellationTokens,
  ) {}

  list(): string[] {
    return [];
  }

  cancel(orderId: string): boolean {
    return this.tokens.issue(orderId).length > 0;
  }

  refund(orderId: string): number {
    return this.payments.refund(orderId);
  }
}
