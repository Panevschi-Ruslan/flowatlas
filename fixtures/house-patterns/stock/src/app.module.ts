import { Module } from '@nestjs/common';
import { StockController } from './stock/stock.controller.js';
import { StockService } from './stock/stock.service.js';

@Module({
  controllers: [StockController],
  providers: [StockService],
})
export class AppModule {}
