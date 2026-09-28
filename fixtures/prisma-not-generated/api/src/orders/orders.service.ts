import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@acme/db';

/** A client handed in, annotated with the type the wrapper re-exports. */
@Injectable()
export class OrdersService {
  constructor(private readonly db: PrismaClient) {}

  cancel(id: string): Promise<unknown> {
    return this.db.order.delete({ where: { id } });
  }
}
