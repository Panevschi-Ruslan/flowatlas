import { Injectable } from '@nestjs/common';
import { EventsService } from './events.service';

/** Every change of an order is told on the shop's orders channel. */
@Injectable()
export class OrdersService {
  constructor(private readonly events: EventsService) {}

  async create(shopId: string): Promise<void> {
    await this.events.orderChanged(shopId);
  }

  async setStatus(shopId: string, orderId: string): Promise<void> {
    void orderId;
    await this.events.orderChanged(shopId);
  }

  async remove(shopId: string, orderId: string): Promise<void> {
    void orderId;
    await this.events.orderChanged(shopId);
  }
}
