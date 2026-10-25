import { formatAmount } from './format';

export class Money {
  constructor(
    readonly amount: number,
    readonly currency: string,
  ) {}

  format(): string {
    return formatAmount(this.amount, this.currency);
  }
}
