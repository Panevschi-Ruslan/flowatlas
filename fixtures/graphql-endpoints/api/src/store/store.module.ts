import { Module } from '@nestjs/common';

import { StorefrontResolver } from './store.resolver';

@Module({
  providers: [StorefrontResolver],
})
export class StoreModule {}
