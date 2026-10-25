import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';

import { AppLogger } from './common/app-logger';
import { Metrics } from './common/metrics';
import { OrderEvents } from './orders/order.events';
import { OrderMapper } from './orders/order.mapper';
import { OrderRepository } from './orders/order.repository';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: 'EVENTS_CLIENT',
        transport: Transport.TCP,
        options: { host: 'localhost', port: 4001 },
      },
    ]),
  ],
  controllers: [OrdersController],
  providers: [AppLogger, Metrics, OrderEvents, OrderMapper, OrderRepository, OrdersService],
})
export class AppModule {}
