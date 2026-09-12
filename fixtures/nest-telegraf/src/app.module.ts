import { Module } from '@nestjs/common';

import { AdminGuard } from './admin.guard.js';
import { CheckoutScene } from './checkout.scene.js';
import { DirectBot } from './direct.bot.js';
import { NotificationsService } from './notifications.service.js';
import { OrdersService } from './orders.service.js';
import { OrdersUpdate } from './orders.update.js';
import { PaymentsUpdate } from './payments.update.js';
import { RegisterWizard } from './register.wizard.js';

@Module({
  providers: [
    AdminGuard,
    CheckoutScene,
    DirectBot,
    NotificationsService,
    OrdersService,
    OrdersUpdate,
    PaymentsUpdate,
    RegisterWizard,
  ],
})
export class AppModule {}
