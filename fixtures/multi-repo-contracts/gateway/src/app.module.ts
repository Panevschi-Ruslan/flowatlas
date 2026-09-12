import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';

import { OrdersClient } from './clients/orders.client';
import { WireClient } from './clients/wire.client';

@Module({
  imports: [HttpModule, ConfigModule.forRoot()],
  providers: [OrdersClient, WireClient],
})
export class AppModule {}
