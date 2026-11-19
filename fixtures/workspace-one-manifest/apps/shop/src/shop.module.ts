import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ORDER_EVENTS_CLIENT, OrderEvents } from '@shop/order-events';

import { CheckoutController } from './checkout/checkout.controller';

@Module({
  imports: [
    ClientsModule.register([
      { name: ORDER_EVENTS_CLIENT, transport: Transport.TCP, options: { host: 'localhost', port: 4001 } },
    ]),
  ],
  controllers: [CheckoutController],
  providers: [OrderEvents],
})
export class ShopModule {}
