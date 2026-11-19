import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { LedgerClientModule, OrdersClientModule } from '@shop/clients';
import { CatalogClient } from './catalog.client';
import { CatalogTenant } from './catalog.tenant';
import { FulfilController } from './fulfil.controller';
import { FulfilService } from './fulfil.service';

/**
 * Configures the two clients the shared package builds: the orders client
 * by a factory (`forRootAsync`), the ledger client with its address written
 * in place (`forRoot`). The method of each module nobody calls provides
 * nothing. The framework's HTTP client is configured with the tenant every
 * request it makes carries (P265).
 */
@Module({
  imports: [
    OrdersClientModule.forRootAsync({ useFactory: () => ({ url: `${process.env.ORDERS_URL}/trpc` }) }),
    LedgerClientModule.forRoot({ url: `${process.env.LEDGER_URL}/rpc` }),
    HttpModule.register({ headers: { 'X-Tenant': 'north' } }),
  ],
  controllers: [FulfilController],
  providers: [FulfilService, CatalogClient, CatalogTenant],
})
export class AppModule {}
