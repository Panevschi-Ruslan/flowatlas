import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Where `ORDERS_DB_URL` is read, and the far end of the `POST /orders` flow. */
@Injectable()
export class OrdersRepository {
  constructor(private readonly config: ConfigService) {}

  save(customerId: string): Promise<unknown> {
    return Promise.resolve({ url: this.config.get('ORDERS_DB_URL'), customerId });
  }

  recent(customerId: string): Promise<unknown[]> {
    return Promise.resolve([{ url: this.config.get('ORDERS_DB_URL'), customerId }]);
  }
}
