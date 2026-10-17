import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';

import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';
import { ShipmentsController } from './shipments/shipments.controller';
import { ShipmentsService } from './shipments/shipments.service';

@Module({
  imports: [
    ClientsModule.register([
      { name: 'EVENTS_CLIENT', transport: Transport.TCP, options: { host: 'localhost', port: 4001 } },
    ]),
  ],
  controllers: [OrdersController, ShipmentsController],
  providers: [OrdersService, ShipmentsService],
})
export class AppModule {}
