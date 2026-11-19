import { Module } from '@nestjs/common';
import { ApolloDriver } from '@nestjs/apollo';
import { GraphQLModule } from '@nestjs/graphql';

import { CustomersService } from './orders/customers.service';
import { OrdersResolver } from './orders/orders.resolver';
import { OrdersService } from './orders/orders.service';

@Module({
  imports: [GraphQLModule.forRoot({ driver: ApolloDriver, autoSchemaFile: true, path: '/graphql' })],
  providers: [OrdersResolver, OrdersService, CustomersService],
})
export class AppModule {}
