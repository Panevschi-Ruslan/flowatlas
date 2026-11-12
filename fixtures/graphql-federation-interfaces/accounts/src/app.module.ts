import { ApolloFederationDriver, type ApolloFederationDriverConfig } from '@nestjs/apollo';
import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';

import { AccountsResolver, UserResolver, WishItemResolver } from './accounts.resolver';
import { AccountsService } from './accounts.service';

@Module({
  imports: [GraphQLModule.forRoot<ApolloFederationDriverConfig>({ driver: ApolloFederationDriver, typePaths: ['./**/*.graphql'] })],
  providers: [AccountsService, AccountsResolver, UserResolver, WishItemResolver],
})
export class AppModule {}
