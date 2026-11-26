import { Module } from '@nestjs/common';

import { TenantBus } from './bus/tenant-bus.service';
import { KitsController } from './kits/kits.controller';
import { StepsController } from './steps/steps.controller';
import { StepsService } from './steps/steps.service';

@Module({
  controllers: [StepsController, KitsController],
  providers: [TenantBus, StepsService],
})
export class AppModule {}
