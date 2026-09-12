import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { OrdersClient } from '../clients/orders.client';

/**
 * A clock is what starts this, not the graph.
 *
 * `flowatlas dead --kind entries` must never report a `cron` entry: nothing
 * inside the project reaches it and nothing ever will, which says nothing at
 * all about whether it runs.
 */
@Injectable()
export class SyncJob {
  constructor(private readonly orders: OrdersClient) {}

  @Cron('0 * * * *')
  hourly(): unknown {
    return this.orders.create('nightly');
  }
}
