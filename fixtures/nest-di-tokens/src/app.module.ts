import { Module } from '@nestjs/common';

import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';

@Module({
  imports: [OrdersModule, PaymentsModule],
})
export class AppModule {}
