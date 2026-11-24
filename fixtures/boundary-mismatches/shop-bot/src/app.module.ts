import { Module } from '@nestjs/common';

import { ShopBot } from './shop-bot';

@Module({
  providers: [ShopBot],
})
export class AppModule {}
