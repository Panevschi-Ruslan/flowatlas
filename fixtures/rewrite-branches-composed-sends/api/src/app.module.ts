import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';

import { ConfigService } from './config/settings';
import { AdminController } from './rest/admin.controller';
import { CatalogController } from './rest/catalog.controller';
import { ExportsController } from './rest/exports.controller';
import { ShopController } from './rest/shop.controller';
import { StoreResolver } from './store/store.resolver';

@Module({
  imports: [
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      useFactory: (config: ConfigService) => ({ path: config.apiOptions.storePath, autoSchemaFile: true }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AdminController, ShopController, ExportsController, CatalogController],
  providers: [ConfigService, StoreResolver],
})
export class AppModule {}
