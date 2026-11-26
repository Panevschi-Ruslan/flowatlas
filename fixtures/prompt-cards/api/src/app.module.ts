import { Module } from '@nestjs/common';

import { ShopBus } from './bus/shop-bus.service';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';
import { ReportsController } from './reports/reports.controller';

@Module({
  controllers: [OrdersController, ReportsController],
  providers: [ShopBus, OrdersService],
})
export class AppModule {}
