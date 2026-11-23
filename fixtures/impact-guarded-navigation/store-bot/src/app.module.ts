import { Module } from '@nestjs/common';

import { ApiClient } from './api.client';
import { StoreBot } from './store-bot';

@Module({
  providers: [StoreBot, ApiClient],
})
export class AppModule {}
