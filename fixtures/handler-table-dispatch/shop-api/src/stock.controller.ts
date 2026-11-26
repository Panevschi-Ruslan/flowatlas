import { Controller, Get } from '@nestjs/common';

@Controller('api/stock')
export class StockController {
  @Get()
  count(): { items: number } {
    return { items: 12 };
  }
}
