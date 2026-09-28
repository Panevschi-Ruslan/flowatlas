import { Module } from '@nestjs/common';

import { StatusController } from '../shared/status.controller';
import { WorkerHealthController } from './worker-health.controller';

@Module({
  controllers: [WorkerHealthController, StatusController],
})
export class WorkerModule {}
