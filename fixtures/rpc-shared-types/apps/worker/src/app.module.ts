import { Module } from '@nestjs/common';
import { LedgerClientModule, OrdersClientModule } from '@shop/clients';
import { CatalogClient } from './catalog.client';
import { FulfilController } from './fulfil.controller';
import { FulfilService } from './fulfil.service';

/**
 * Configures the two clients the shared package builds: the orders client
 * by a factory (`forRootAsync`), the ledger client with its address written
 * in place (`forRoot`). The method of each module nobody calls provides
 * nothing.
 */
@Module({
  imports: [
    OrdersClientModule.forRootAsync({ useFactory: () => ({ url: `${process.env.ORDERS_URL}/trpc` }) }),
    LedgerClientModule.forRoot({ url: `${process.env.LEDGER_URL}/rpc` }),
  ],
  controllers: [FulfilController],
  providers: [FulfilService, CatalogClient],
})
export class AppModule {}
