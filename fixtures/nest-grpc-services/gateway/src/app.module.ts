import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { OrdersGatewayController } from './orders.controller';
import { OrdersClient } from './orders.client';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: 'ORDERS',
        transport: Transport.GRPC,
        options: {
          package: 'orders',
          protoPath: join(__dirname, '../../proto/orders.proto'),
          url: process.env.ORDERS_GRPC_URL,
        },
      },
    ]),
  ],
  controllers: [OrdersGatewayController],
  providers: [OrdersClient],
})
export class AppModule {}
