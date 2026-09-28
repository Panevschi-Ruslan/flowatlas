import { Module } from '@nestjs/common';

import { HealthController } from './health/health.controller';
import { LegacyController } from './legacy/legacy.controller';
import { TopicsV1Controller } from './topics/topics.v1.controller';
import { TopicsV2Controller } from './topics/topics.v2.controller';

@Module({
  controllers: [HealthController, LegacyController, TopicsV1Controller, TopicsV2Controller],
})
export class AppModule {}
