import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';

import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';
import { TelemetryService } from './orders/telemetry.service';

/**
 * `ClientsModule.register` is where the `KAFKA_CLIENT` token gets its transport.
 * It is the tie-breaker D4 describes: when two broker adapters could claim the
 * same `ClientProxy`, the transport on the resolvable client token decides.
 */
@Module({
  imports: [
    ClientsModule.register([
      {
        name: 'KAFKA_CLIENT',
        transport: Transport.KAFKA,
        options: { client: { clientId: 'orders', brokers: ['localhost:9092'] } },
      },
    ]),
  ],
  controllers: [OrdersController],
  providers: [OrdersService, TelemetryService],
})
export class AppModule {}
