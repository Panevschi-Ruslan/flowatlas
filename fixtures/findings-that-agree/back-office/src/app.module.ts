import { Module } from '@nestjs/common';
import { CatalogHandlers } from './catalog/catalog-handlers';
import { CatalogRelayController } from './catalog/catalog-relay.controller';

@Module({
  controllers: [CatalogRelayController],
  providers: [CatalogHandlers],
})
export class AppModule {}
