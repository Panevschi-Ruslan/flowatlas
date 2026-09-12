import { Injectable } from '@nestjs/common';

@Injectable()
export class OrdersService {
  cancel(orderId: string): string {
    return `cancelled-${orderId}`;
  }

  find(orderId: string): string {
    return `order-${orderId}`;
  }
}
