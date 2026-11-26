import { Module } from '@nestjs/common';
import { LiveController } from './live/live.controller';
import { RelayService } from './live/relay.service';
import { ParcelsController } from './parcels/parcels.controller';
import { ParcelsService } from './parcels/parcels.service';

@Module({
  controllers: [ParcelsController, LiveController],
  providers: [ParcelsService, RelayService],
})
export class AppModule {}
