import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { CourierBot } from './courier-bot';
import { ShopClient } from './shop.client';

@Module({
  imports: [HttpModule, ConfigModule.forRoot()],
  providers: [CourierBot, ShopClient],
})
export class AppModule {}
