import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { ItemsController } from './items/items.controller';

@Module({
  controllers: [HealthController, ItemsController],
})
export class AppModule {}
