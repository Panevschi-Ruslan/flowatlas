import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';

import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';

@Module({
  imports: [
    ClientsModule.register([
      { name: 'EVENTS_CLIENT', transport: Transport.TCP, options: { host: 'localhost', port: 4001 } },
    ]),
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class AppModule {}
