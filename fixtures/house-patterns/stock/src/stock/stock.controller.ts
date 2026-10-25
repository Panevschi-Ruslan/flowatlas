import { Body, Controller, Post } from '@nestjs/common';
import { StockService, type Reservation } from './stock.service.js';

@Controller('stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Post('reserve')
  reserve(@Body() reservation: Reservation): { reserved: number } {
    return this.stock.reserve(reservation);
  }
}
