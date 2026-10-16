import { Controller, Get } from '@nestjs/common';

import { StockItem } from './stock-item.entity';
import { StockService } from './stock.service';

/**
 * Nothing in front of either route and nothing in the body: both remain
 * `route-unguarded`. What `flowatlas accept --path 'GET /levels/*'` is for,
 * when they are public by decision.
 */
@Controller('levels')
export class LevelsController {
  constructor(private readonly stock: StockService) {}

  @Get('summary')
  summary(): Promise<StockItem[]> {
    return this.stock.all();
  }

  @Get('low')
  low(): Promise<StockItem[]> {
    return this.stock.all();
  }
}
