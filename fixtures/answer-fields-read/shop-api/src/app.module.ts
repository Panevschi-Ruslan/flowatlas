import { Module } from '@nestjs/common';
import { OrdersController } from './orders/orders.controller';
import { ProfileController } from './profile/profile.controller';

@Module({
  controllers: [OrdersController, ProfileController],
})
export class AppModule {}
