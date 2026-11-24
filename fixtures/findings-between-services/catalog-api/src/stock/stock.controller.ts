import { Controller, Get, Param } from '@nestjs/common';
import { StockService } from './stock.service';

/**
 * No guard here and none beside it: an internal route only the storefront's
 * server calls. Listed as unguarded, below the product route that deletes.
 */
@Controller('stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get(':sku')
  level(@Param('sku') sku: string): Promise<number> {
    return this.stock.level(sku);
  }
}
