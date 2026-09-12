import { Module } from '@nestjs/common';

import { FilesController } from './files/files.controller';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';
import { ReportsController } from './reports/reports.controller';

@Module({
  controllers: [OrdersController, FilesController, ReportsController],
  providers: [OrdersService],
})
export class AppModule {}
