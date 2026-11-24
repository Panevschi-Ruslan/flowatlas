import { Injectable } from '@nestjs/common';
import { EventsService } from './events.service';

/** Every change of an order is told on the shop's channels: a new one, a status, a payment, a removal. */
@Injectable()
export class OrdersService {
  constructor(private readonly events: EventsService) {}

  async create(shopId: string): Promise<void> {
    await this.events.orderChanged(shopId);
  }

  async setStatus(shopId: string, orderId: string): Promise<void> {
    void orderId;
    await this.events.orderChanged(shopId);
    await this.events.orderClosed(shopId);
  }

  async pay(shopId: string, orderId: string): Promise<void> {
    void orderId;
    await this.events.orderPaid(shopId);
    await this.events.orderChanged(shopId);
  }

  async remove(shopId: string, orderId: string): Promise<void> {
    void orderId;
    await this.events.orderClosed(shopId);
  }
}
