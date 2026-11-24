import { Controller, Param, Post } from '@nestjs/common';
import { StockService } from './stock.service';

@Controller('stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Post(':itemId/recount')
  async recount(@Param('itemId') itemId: string): Promise<void> {
    await this.stock.recount(itemId);
  }
}
