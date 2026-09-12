import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';

import { DeepController } from './deep/deep.controller';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';
import { OrdersRpcController } from './rpc/orders.rpc.controller';
import { WireController } from './wire/wire.controller';

/**
 * `EVENTS_CLIENT` is the token `OrdersService` publishes through. The transport
 * does not matter here: a publish is a publish whatever carries it, and this
 * fixture is about what crosses rather than about how.
 */
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
  controllers: [OrdersController, WireController, DeepController, OrdersRpcController],
  providers: [OrdersService],
})
export class AppModule {}
