import { Injectable } from '@nestjs/common';
import { OrdersService } from './orders.service';

/** Reads an update the chat platform posted and calls the method directly, past the route. */
@Injectable()
export class ChatUpdatesService {
  constructor(private readonly orders: OrdersService) {}

  async handleUpdate(update: { orderId: string; text: string }): Promise<void> {
    if (update.text.startsWith('/done')) await this.orders.updateStatus(update.orderId, 'done');
  }
}
