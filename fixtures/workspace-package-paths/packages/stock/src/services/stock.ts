// The package reaches its own repository through an alias only its own tsconfig
// defines. The service that declares this package compiles with a tsconfig that
// has never heard of `@repositories`.
import { StockLevelRepository } from '@repositories';

export class StockService {
  private readonly levels = new StockLevelRepository();

  async available(sku: string): Promise<number> {
    return this.levels.available(sku);
  }
}
