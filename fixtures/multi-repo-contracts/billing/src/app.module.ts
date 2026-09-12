import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';

import { InvoicesConsumer } from './invoices/invoices.consumer';
import { OrdersRpcClient } from './invoices/orders.rpc.client';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: 'ORDERS_CLIENT',
        transport: Transport.TCP,
        options: { host: 'localhost', port: 4001 },
      },
    ]),
  ],
  controllers: [InvoicesConsumer],
  providers: [OrdersRpcClient],
})
export class AppModule {}
