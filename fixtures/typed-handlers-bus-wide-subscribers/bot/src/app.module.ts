import { Module } from '@nestjs/common';

import { Bot } from './bot/bot';
import { RelayController } from './events/relay.controller';

@Module({
  controllers: [RelayController],
  providers: [Bot],
})
export class AppModule {}
