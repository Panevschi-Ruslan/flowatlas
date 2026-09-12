import { Module } from '@nestjs/common';

import { OrdersClient } from './clients/orders.client';
import { GatewayController } from './orders/gateway.controller';

@Module({
  controllers: [GatewayController],
  providers: [OrdersClient],
})
export class AppModule {}
