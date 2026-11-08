import { Module } from '@nestjs/common';
import { AuditModule, LEDGER_CLIENT, ledgerClient, OrdersClientModule } from '@shop/clients';
import { FulfilController } from './fulfil.controller';
import { FulfilService } from './fulfil.service';

/**
 * Configures the clients the shared package builds: the orders client by a
 * factory (`forRootAsync`) handing it the base address from a setting, the
 * ledger client by the package's function, called once with a setting, and
 * the audit token by `register`.
 */
@Module({
  imports: [OrdersClientModule.forRootAsync({ useFactory: () => ({ base: process.env.ORDERS_URL }) }), AuditModule.register('worker')],
  controllers: [FulfilController],
  providers: [FulfilService, { provide: LEDGER_CLIENT, useFactory: () => ledgerClient(process.env.LEDGER_URL) }],
})
export class AppModule {}
