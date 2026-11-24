import { Module } from '@nestjs/common';
import { CancellationTokens } from './common/cancellation-tokens';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';
import { PaymentsController } from './payments/payments.controller';
import { PaymentsService } from './payments/payments.service';

@Module({
  controllers: [OrdersController, PaymentsController],
  providers: [OrdersService, PaymentsService, CancellationTokens],
})
export class AppModule {}
