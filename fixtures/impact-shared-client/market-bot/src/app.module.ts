import { Module } from '@nestjs/common';

import { AppService } from './app.service';
import { MarketBot } from './market-bot';

@Module({
  providers: [MarketBot, AppService],
})
export class AppModule {}
