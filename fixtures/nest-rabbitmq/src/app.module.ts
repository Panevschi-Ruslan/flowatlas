import { Module } from '@nestjs/common';
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { ClientsModule, Transport } from '@nestjs/microservices';

import { OrdersConsumer } from './orders/orders.consumer';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';

@Module({
  imports: [
    RabbitMQModule.forRoot({
      uri: 'amqp://localhost:5672',
      exchanges: [{ name: 'orders-x', type: 'topic' }],
      connectionInitOptions: { wait: false },
    }),
    // The transport on the resolvable client token is what keeps this
    // `ClientProxy` with the `nestjs-rabbitmq` adapter rather than the kafka one
    // (D4).
    ClientsModule.register([
      {
        name: 'RMQ_CLIENT',
        transport: Transport.RMQ,
        options: { urls: ['amqp://localhost:5672'], queue: 'orders-rpc-q' },
      },
    ]),
  ],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersConsumer],
})
export class AppModule {}
