import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { PaymentsClient } from '@acme/payments-client';

/**
 * Two signs of the same repository that is not here: a client package from
 * it, imported and never installed, and a message onto `payment.requested`,
 * which nothing in the configured repositories consumes.
 */
@Injectable()
export class OrdersService {
  private readonly payments = new PaymentsClient();

  constructor(@Inject('EVENTS_CLIENT') private readonly events: ClientProxy) {}

  async confirm(id: string, amount: number): Promise<string> {
    const hold = await this.payments.authorize(id, amount);
    this.events.emit('payment.requested', { orderId: id, amount, hold: hold.id });
    return hold.id;
  }
}
