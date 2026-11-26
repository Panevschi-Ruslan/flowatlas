import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { OpsBot } from './ops-bot';
import { ShopClient } from './shop.client';

@Module({
  imports: [HttpModule, ConfigModule.forRoot()],
  providers: [OpsBot, ShopClient],
})
export class AppModule {}
