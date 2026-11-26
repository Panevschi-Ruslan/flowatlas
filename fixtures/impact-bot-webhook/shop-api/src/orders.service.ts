import { Injectable } from '@nestjs/common';

/** The method asked about: the route, the bot's command and the bot's webhook all reach it. */
@Injectable()
export class OrdersService {
  private readonly statuses = new Map<string, string>();

  async updateStatus(orderId: string, status: string): Promise<void> {
    this.statuses.set(orderId, status);
  }
}
