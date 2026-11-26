import { Injectable } from '@nestjs/common';

/** `listActive` is the method asked about: the bot's button and its command both reach it. */
@Injectable()
export class OrdersService {
  private readonly statuses = new Map<string, string>();

  async listActive(): Promise<Array<{ id: string; summary: string }>> {
    return [...this.statuses.entries()].map(([id, status]) => ({ id, summary: `${id}: ${status}` }));
  }

  async setStatus(orderId: string, status: string): Promise<void> {
    this.statuses.set(orderId, status);
  }
}
