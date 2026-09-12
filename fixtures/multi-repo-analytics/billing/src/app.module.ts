import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';

import { OrdersClient } from './clients/orders.client';
import { InvoicesController } from './invoices/invoices.controller';
import { InvoicesService } from './invoices/invoices.service';
import { OrdersConsumer } from './invoices/orders.consumer';
import { OrphanConsumer } from './invoices/orphan.consumer';

@Module({
  imports: [
    ClientsModule.register([
      { name: 'EVENTS_CLIENT', transport: Transport.TCP, options: { host: 'localhost', port: 4002 } },
    ]),
  ],
  controllers: [InvoicesController, OrdersConsumer, OrphanConsumer],
  providers: [InvoicesService, OrdersClient],
})
export class AppModule {}
