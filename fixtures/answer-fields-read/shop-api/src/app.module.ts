import { Module } from '@nestjs/common';
import { OrdersController } from './orders/orders.controller';
import { ProfileController } from './profile/profile.controller';
import { SettingsController } from './settings/settings.controller';

@Module({
  controllers: [OrdersController, ProfileController, SettingsController],
})
export class AppModule {}
