import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { ShopBus } from '../bus/shop-bus.service';
import { Mails } from './mails.service';

interface OrderCancelled {
  type: 'ORDER_CANCELLED';
  orderId: string;
  reason: string;
}

interface AuditLine {
  orderId: string;
  action: string;
}

/** The shop's channel arrives here and is told apart by `type`; the audit channel goes straight to a method. */
@Injectable()
export class OrderMailDispatcher implements OnModuleInit {
  constructor(
    private readonly bus: ShopBus,
    private readonly mails: Mails,
  ) {}

  onModuleInit(): void {
    this.bus.subscribe('shop:*:orders', (event: OrderCancelled) => this.dispatch(event));
    this.bus.subscribe('audit', (line: AuditLine) => this.mails.audit(line));
  }

  dispatch(event: OrderCancelled): void {
    switch (event.type) {
      case 'ORDER_CANCELLED':
        return this.mails.cancelled(event.orderId, event.reason);
      default:
        return;
    }
  }
}
