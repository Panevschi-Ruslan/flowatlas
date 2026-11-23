import { Injectable } from '@nestjs/common';
import { StockService } from '../stock/stock.service';

/** Each method calls two of the stock's methods. */
@Injectable()
export class CheckoutService {
  constructor(private readonly stock: StockService) {}

  place(sku: string, qty: number): boolean {
    if (this.stock.level(sku) < qty) return false;
    this.stock.reserve(sku, qty);
    return true;
  }

  cancel(sku: string, qty: number): number {
    this.stock.release(sku, qty);
    return this.stock.level(sku);
  }
}
