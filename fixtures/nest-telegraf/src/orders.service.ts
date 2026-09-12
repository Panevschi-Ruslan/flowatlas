import { Injectable } from '@nestjs/common';

@Injectable()
export class OrdersService {
  create(chatId: number): string {
    return `order-${String(chatId)}`;
  }
}
