import { Module } from '@nestjs/common';

import { EntriesController } from './entries/entries.controller';
import { LEDGER_PROVIDERS } from './entries/providers';
import { extraProviders } from './entries/extra';

/**
 * Providers assembled from an array declared elsewhere, which is read, and
 * from a call, which is not: a `module-providers-unread` row says so.
 */
@Module({
  controllers: [EntriesController],
  providers: [...LEDGER_PROVIDERS, ...extraProviders()],
})
export class AppModule {}
