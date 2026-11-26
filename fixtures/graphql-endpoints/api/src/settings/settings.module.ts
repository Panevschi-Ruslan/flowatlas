import { Module } from '@nestjs/common';

import { ShopSettingsResolver } from './settings.resolver';

@Module({
  providers: [ShopSettingsResolver],
})
export class SettingsModule {}
