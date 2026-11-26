import { Injectable } from '@nestjs/common';

/**
 * The class asked about. Its methods share callers: checkout places and
 * cancels through `level`, `reserve` and `release`, the nightly job tops up
 * through `level` and `restock`, and the daily report reads `level` four
 * calls down.
 */
@Injectable()
export class StockService {
  private readonly counts = new Map<string, number>();

  level(sku: string): number {
    return this.counts.get(sku) ?? 0;
  }

  reserve(sku: string, qty: number): void {
    this.counts.set(sku, (this.counts.get(sku) ?? 0) - qty);
  }

  release(sku: string, qty: number): void {
    this.counts.set(sku, (this.counts.get(sku) ?? 0) + qty);
  }

  restock(sku: string): void {
    this.counts.set(sku, 100);
  }
}
