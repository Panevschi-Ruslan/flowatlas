import { Injectable } from '@nestjs/common';
import { Consumes } from '@flowatlas/markers';

interface StockEvent {
  type: string;
  sku?: string;
}

/**
 * Waits for `STOCK_LOW`, which no publish says it sends. One publish on the
 * channel sends a type chosen by its caller, which may be it: held back.
 */
@Injectable()
export class StockEventsService {
  private readonly low = new Set<string>();

  @Consumes('stock_events')
  onStockEvent(evt: StockEvent): void {
    switch (evt.type) {
      case 'STOCK_LOW':
        this.low.add(evt.sku ?? '');
        return;
      case 'STOCK_RESTOCKED':
        this.low.delete(evt.sku ?? '');
        return;
      default:
        return;
    }
  }
}
