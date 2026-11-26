import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { StockController } from './stock.controller';

@Module({
  controllers: [OrdersController, ReportsController, StockController],
  providers: [OrdersService, ReportsService],
})
export class AppModule {}
