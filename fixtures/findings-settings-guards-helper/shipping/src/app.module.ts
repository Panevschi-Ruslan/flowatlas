import { Module } from '@nestjs/common';

import { StaffGuard } from './auth/staff.guard';
import { ClaimRefundsController } from './claims/claim-refunds.controller';
import { ClaimsController } from './claims/claims.controller';
import { DepotsController } from './depots/depots.controller';
import { ParcelsController } from './parcels/parcels.controller';
import { PickupsController } from './pickups/pickups.controller';

@Module({
  controllers: [ClaimsController, ClaimRefundsController, ParcelsController, PickupsController, DepotsController],
  providers: [StaffGuard],
})
export class AppModule {}
