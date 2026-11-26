import { Injectable } from '@nestjs/common';
import { Consumes } from '@flowatlas/markers';

interface StockEvent {
  type: string;
  sku?: string;
  remaining?: number;
}

/** Pages the warehouse when an item runs low. */
@Injectable()
export class StockAlerts {
  @Consumes('stock_events')
  onStock(evt: StockEvent): void {
    if (evt.type !== 'STOCK_LOW') return;
    this.page(evt.sku, evt.remaining);
  }

  page(sku: string | undefined, remaining: number | undefined): void {
    console.log(`low on ${sku ?? '?'}: ${remaining ?? 0} left`);
  }
}
