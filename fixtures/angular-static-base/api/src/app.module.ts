import { Module } from '@nestjs/common';

import { ItemsController } from './items/items.controller';

@Module({
  controllers: [ItemsController],
})
export class AppModule {}
