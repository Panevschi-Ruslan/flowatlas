import { Module } from '@nestjs/common';

import { ShopBus } from './bus/shop-bus.service';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';
import { Receipts } from './orders/receipts.service';

@Module({
  controllers: [OrdersController],
  providers: [ShopBus, OrdersService, Receipts],
})
export class AppModule {}
