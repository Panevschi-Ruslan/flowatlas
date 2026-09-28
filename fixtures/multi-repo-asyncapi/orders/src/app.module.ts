import { Module } from '@nestjs/common';

import { EventBus } from './bus/event-bus.service';
import { InvoiceConsumer } from './orders/invoice.consumer';
import { OrdersService } from './orders/orders.service';

@Module({
  controllers: [InvoiceConsumer],
  providers: [EventBus, OrdersService],
})
export class AppModule {}
