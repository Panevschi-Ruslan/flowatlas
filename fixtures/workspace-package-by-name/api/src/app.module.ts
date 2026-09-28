import { Module } from '@nestjs/common';
import { StockController } from './stock/stock.controller.js';

@Module({ controllers: [StockController] })
export class AppModule {}
