import { Injectable } from '@nestjs/common';

@Injectable()
export class OrdersService {
  private readonly placed = new Map<string, number>();

  record(orderId: string, total: number): void {
    this.placed.set(orderId, total);
  }
}
