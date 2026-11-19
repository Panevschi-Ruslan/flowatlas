import { Module } from '@nestjs/common';
import { ApolloFederationDriver, ApolloFederationDriverConfig } from '@nestjs/apollo';
import { GraphQLModule } from '@nestjs/graphql';

import { CustomersResolver } from './customers/customers.resolver';
import { CustomersService } from './customers/customers.service';

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloFederationDriverConfig>({
      driver: ApolloFederationDriver,
      autoSchemaFile: { federation: 2 },
      path: '/graphql',
    }),
  ],
  providers: [CustomersResolver, CustomersService],
})
export class AppModule {}
