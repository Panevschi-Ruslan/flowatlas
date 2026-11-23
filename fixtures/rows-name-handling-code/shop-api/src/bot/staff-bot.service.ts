import { Injectable } from '@nestjs/common';

import { OrdersService } from '../orders/orders.service';

export interface CallbackQuery {
  id: string;
  data: string;
}

/** The staff's chat bot. The worker hands it each button pressed; `cancel:<order>` cancels the order. */
@Injectable()
export class StaffBot {
  constructor(private readonly orders: OrdersService) {}

  async handleCallbackQuery(query: CallbackQuery): Promise<void> {
    const [action, orderId] = query.data.split(':');
    if (action === 'cancel') await this.orders.cancel(orderId, 'staff');
  }
}
