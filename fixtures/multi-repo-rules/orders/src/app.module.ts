import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';

import { CurrentAliasesController } from './aliases/current-aliases.controller';
import { LegacyAliasesController } from './aliases/legacy-aliases.controller';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';

/**
 * Both alias controllers are registered, which is what makes `GET /a/:param`
 * genuinely ambiguous rather than dead code.
 *
 * `EVENTS_CLIENT` is the token `OrdersService` publishes through. The transport
 * is TCP because the transport does not matter to the linker: `emit` on a
 * `ClientProxy` is a producer whatever carries it, and this fixture is about
 * stitching producers to consumers across repositories, not about brokers.
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
  controllers: [OrdersController, LegacyAliasesController, CurrentAliasesController],
  providers: [OrdersService],
})
export class AppModule {}
