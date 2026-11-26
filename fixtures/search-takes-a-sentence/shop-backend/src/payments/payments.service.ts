import { Injectable } from '@nestjs/common';

@Injectable()
export class PaymentsService {
  capture(orderId: string, amount: number): number {
    return orderId.length + amount;
  }

  refund(orderId: string): number {
    return -orderId.length;
  }
}
