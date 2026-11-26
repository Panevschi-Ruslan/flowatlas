import { Module } from '@nestjs/common';
import { OrderExportsController } from './order-exports.controller';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

/**
 * `OrdersController` is registered first, so its `GET orders/:orderId` is
 * tried before `OrderExportsController`'s `GET orders/export`.
 */
@Module({
  controllers: [OrdersController, OrderExportsController],
  providers: [OrdersService],
})
export class OrdersModule {}
