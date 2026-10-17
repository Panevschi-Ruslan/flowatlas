import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';

import { InvoicesController } from './invoices/invoices.controller';
import { PlacedConsumer } from './invoices/placed.consumer';

@Module({
  imports: [
    ClientsModule.register([
      { name: 'EVENTS_CLIENT', transport: Transport.TCP, options: { host: 'localhost', port: 4001 } },
    ]),
  ],
  controllers: [InvoicesController, PlacedConsumer],
})
export class AppModule {}
