import { Module } from '@nestjs/common';

import { AccountsController } from './accounts/accounts.controller';
import { AccountsService } from './accounts/accounts.service';
import { AuthGuard } from './auth/auth.guard';
import { OrdersClient } from './clients/orders.client';
import { LegacyController } from './orders/legacy.controller';
import { OrdersController } from './orders/orders.controller';

@Module({
  controllers: [OrdersController, AccountsController, LegacyController],
  providers: [OrdersClient, AccountsService, AuthGuard],
})
export class AppModule {}
