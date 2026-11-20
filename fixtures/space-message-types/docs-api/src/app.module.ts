import { Module } from '@nestjs/common';

import { SpaceBus } from './bus/space-bus.service';
import { SpacesController } from './spaces/spaces.controller';
import { SpacesService } from './spaces/spaces.service';

@Module({
  controllers: [SpacesController],
  providers: [SpaceBus, SpacesService],
})
export class AppModule {}
