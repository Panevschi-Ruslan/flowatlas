import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';

import { SessionGuard } from './session.guard';
import { StockItem } from './stock-item.entity';
import { StockService } from './stock.service';

/** Guarded at the controller: both routes `where: controller`, no row. */
@UseGuards(SessionGuard)
@Controller('stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get()
  all(): Promise<StockItem[]> {
    return this.stock.all();
  }

  @Post()
  add(@Body() item: StockItem): Promise<StockItem> {
    return this.stock.save(item);
  }
}
