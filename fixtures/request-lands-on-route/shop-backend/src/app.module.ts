import { Module } from '@nestjs/common';
import { AdminCatalogController } from './catalog/admin-catalog.controller';
import { CatalogService } from './catalog/catalog.service';
import { AdminOrdersController } from './orders/admin-orders.controller';
import { OrdersService } from './orders/orders.service';

@Module({
  controllers: [AdminCatalogController, AdminOrdersController],
  providers: [CatalogService, OrdersService],
})
export class AppModule {}
