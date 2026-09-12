import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';

import { OrdersClient } from './clients/orders.client';

@Module({
  imports: [HttpModule, ConfigModule.forRoot()],
  providers: [OrdersClient],
})
export class AppModule {}
