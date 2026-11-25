import { Module } from '@nestjs/common';
import { AuditController } from './audit/audit.controller';
import { AuditService } from './audit/audit.service';
import { BuildsController } from './builds/builds.controller';
import { BuildBus } from './builds/build-bus';
import { BuildsService } from './builds/builds.service';
import { LiveController } from './live/live.controller';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';
import { StoresController } from './stores/stores.controller';

@Module({
  controllers: [OrdersController, AuditController, LiveController, StoresController, BuildsController],
  providers: [OrdersService, AuditService, BuildsService, BuildBus],
})
export class AppModule {}
