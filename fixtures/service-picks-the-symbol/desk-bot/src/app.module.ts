import { Module } from '@nestjs/common';

import { DeskBot } from './desk-bot';
import { GatewayClient } from './gateway.client';

@Module({
  providers: [DeskBot, GatewayClient],
})
export class AppModule {}
