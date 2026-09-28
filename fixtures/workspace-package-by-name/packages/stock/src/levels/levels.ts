export class StockLevels {
  async count(sku: string): Promise<number> {
    return sku.length;
  }
}
