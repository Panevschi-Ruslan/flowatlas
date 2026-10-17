import { Module } from '@nestjs/common';

import { ParcelDispatch } from './dispatch';
import { ParcelExport } from './export';
import { ParcelsController } from './parcels.controller';
import { ParcelsService } from './parcels.service';
import { ParcelRetry } from './retry';
import { RegionSeed } from './seed';
import { ParcelSync } from './sync';

@Module({
  controllers: [ParcelsController],
  providers: [ParcelsService, ParcelExport, ParcelSync, ParcelRetry, RegionSeed, ParcelDispatch],
})
export class ParcelsModule {}
