import { Module } from '@nestjs/common';

import { OwnerGuard } from './guards/owner.guard';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';

@Module({
  controllers: [OrdersController],
  providers: [OrdersService, OwnerGuard],
})
export class AppModule {}
