import { StockLevels } from '../levels/levels.js';

export class StockService {
  private readonly levels = new StockLevels();

  async available(sku: string): Promise<number> {
    return this.levels.count(sku);
  }
}
