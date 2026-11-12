import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { CatalogController } from '@shop/catalog';

import { HealthController } from './health.controller';
import { OrdersResolver } from './orders/orders.resolver';
import { OrdersService } from './orders/orders.service';

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: true,
    }),
  ],
  // The catalog's controller is a library's, written in a package no service
  // is configured on: it is this API's way in, as it always was.
  controllers: [HealthController, CatalogController],
  providers: [OrdersResolver, OrdersService],
})
export class AppModule {}
