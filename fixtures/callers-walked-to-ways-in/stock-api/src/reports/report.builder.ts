import { Injectable } from '@nestjs/common';
import { StockService } from '../stock/stock.service';

/** A long chain: the report reaches the stock's level through three of its own methods. */
@Injectable()
export class ReportBuilder {
  constructor(private readonly stock: StockService) {}

  build(skus: string[]): string[] {
    return skus.map((sku) => this.section(sku));
  }

  private section(sku: string): string {
    return `${sku}: ${this.row(sku)}`;
  }

  private row(sku: string): string {
    return String(this.stock.level(sku));
  }
}
