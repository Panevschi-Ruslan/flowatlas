import { Injectable, Logger } from '@nestjs/common';

import { UsersService } from '../users/users.service';
import { OrderSource } from './order-source.interface';

@Injectable()
export class OrdersService {
  /** Method name is only known at runtime. */
  private readonly hook: string = 'validate';

  constructor(
    private readonly users: UsersService,
    // Logger is declared in @nestjs/common: an external provider. Calls on it are
    // counted in meta.stats.skippedExternalCalls, never turned into `calls` edges.
    private readonly logger: Logger,
    // unresolved: di-type-unresolved — an interface has no class declaration to inject.
    private readonly source: OrderSource,
  ) {}

  findAll(): string[] {
    this.logger.log('listing orders');
    return this.source.list();
  }

  findOne(id: string): string {
    this.validate(id);
    const owner = this.users.findOne(id);
    return `${id}:${owner}`;
  }

  create(userId: string): string {
    this.runHook();
    return this.users.findOne(userId);
  }

  remove(orderId: string): string {
    this.validate(orderId);
    return orderId;
  }

  validate(id: string): void {
    if (id.length === 0) {
      this.logger.warn('empty order id');
    }
  }

  runHook(): void {
    // unresolved: call-dynamic-receiver — the member name is a runtime string.
    this[this.hook]();
  }
}
