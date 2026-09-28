import { Controller, Get, Param } from '@nestjs/common';
import { StockService } from '@acme/stock';

@Controller('stock')
export class StockController {
  private readonly stock = new StockService();

  @Get(':sku')
  available(@Param('sku') sku: string): Promise<number> {
    return this.stock.available(sku);
  }
}
