import { Module } from '@nestjs/common';

import { StoresResolver } from './admin.resolver';

@Module({
  providers: [StoresResolver],
})
export class AdminModule {}
