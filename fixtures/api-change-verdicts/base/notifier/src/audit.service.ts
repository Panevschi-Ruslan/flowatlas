import { Injectable } from '@nestjs/common';
import { Consumes } from '@flowatlas/markers';

interface StockChangedEvent {
  itemId: string;
  warehouse: string;
  count: number;
}

/** Keeps every stock change as it came: the whole message is spread into the record, no field read by name. */
@Injectable()
export class AuditService {
  private readonly records: Array<Record<string, unknown>> = [];

  @Consumes('stock.changed')
  onStockChanged(evt: StockChangedEvent): void {
    this.records.push({ ...evt, at: Date.now() });
  }
}
