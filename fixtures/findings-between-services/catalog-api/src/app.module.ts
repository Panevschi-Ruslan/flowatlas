import { Module } from '@nestjs/common';
import { StaffGuard } from './auth/staff.guard';
import { EventBus } from './bus/event-bus';
import { ProductsController } from './products/products.controller';
import { ProductsService } from './products/products.service';
import { StockController } from './stock/stock.controller';
import { StockService } from './stock/stock.service';

@Module({
  controllers: [ProductsController, StockController],
  providers: [ProductsService, StockService, EventBus, StaffGuard],
})
export class AppModule {}
