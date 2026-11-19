import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { OrdersClient } from './orders.client';
import { legacySettings, ordersSettings } from './settings';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, load: [ordersSettings, legacySettings] })],
  providers: [OrdersClient],
})
export class AppModule {}
