import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';

import { AuditService } from '../audit/audit.service';
import { AccountsClient } from '../clients/accounts.client';
import { BillingClient } from '../clients/billing.client';
import { OrdersRepository } from './orders.repository';

@Injectable()
export class OrdersService {
  constructor(
    private readonly repository: OrdersRepository,
    private readonly accounts: AccountsClient,
    private readonly billing: BillingClient,
    private readonly audit: AuditService,
    @Inject('EVENTS_CLIENT') private readonly events: ClientProxy,
  ) {}

  async create(customerId: string): Promise<unknown> {
    const order = await this.repository.save(customerId);
    await this.billing.requestInvoice(String(order));
    this.audit.record('order.created', customerId);
    return this.normalise(order);
  }

  /** Answering "recent orders" asks `gateway` who the customer is. */
  async recent(customerId: string): Promise<unknown> {
    const rows = await this.repository.recent(customerId);
    return this.accounts.enrich(customerId, rows);
  }

  /**
   * Mutual recursion between two methods of one class.
   *
   * An order line may hold nested lines, so normalising one expands its
   * children and expanding a child normalises it. Correct, intentional, and
   * still a cycle: `flowatlas cycles` reports it without `--cross-service` and
   * leaves it out with the flag, which is the distinction the flag is for.
   */
  normalise(order: unknown): unknown {
    return this.expand(order);
  }

  expand(order: unknown): unknown {
    return order === null ? null : this.normalise(order);
  }

  /**
   * The step that closes the message loop.
   *
   * Publishing `order.changed` here is what `billing` reacts to, and what
   * `billing` publishes in reply lands back on this method.
   */
  sync(orderId: string): void {
    this.events.emit('order.changed', { orderId });
  }
}
