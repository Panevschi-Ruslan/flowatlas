import { Module } from '@nestjs/common';

import { AuditGateway } from './orders/audit.gateway';
import { OrdersGateway } from './orders/orders.gateway';
import { OrdersService } from './orders/orders.service';
import { ReportsGateway } from './orders/reports.gateway';

@Module({
  // A gateway is a provider like any other; nothing else registers one.
  providers: [OrdersGateway, AuditGateway, ReportsGateway, OrdersService],
})
export class AppModule {}
