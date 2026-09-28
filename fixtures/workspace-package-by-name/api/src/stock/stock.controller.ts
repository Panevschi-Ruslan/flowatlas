import { Controller, Get, Param } from '@nestjs/common';
// Both imported by the package's own name. Nothing is installed, so there is no
// `node_modules/@acme/stock` link, and `api/tsconfig.json` aliases neither.
import { StockService } from '@acme/stock';
import { LevelFormat } from '@acme/stock/levels/format';
// A package of the same workspace that `api` does not declare. It is not part
// of the service, so its name leads nowhere, installed or not.
import { Ledger } from '@acme/ledger';

@Controller('stock')
export class StockController {
  private readonly stock = new StockService();
  private readonly levels = new LevelFormat();
  private readonly ledger = new Ledger();

  @Get(':sku')
  async available(@Param('sku') sku: string): Promise<string> {
    this.ledger.record(sku);
    return this.levels.format(await this.stock.available(sku));
  }
}
