import { Module } from '@nestjs/common';

import { ParcelsModule } from './parcels/parcels.module';

@Module({
  imports: [ParcelsModule],
})
export class AppModule {}
