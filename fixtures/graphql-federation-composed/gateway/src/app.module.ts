import { IntrospectAndCompose } from '@apollo/gateway';
import { Module } from '@nestjs/common';
import { ApolloGatewayDriver, ApolloGatewayDriverConfig } from '@nestjs/apollo';
import { GraphQLModule } from '@nestjs/graphql';

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloGatewayDriverConfig>({
      driver: ApolloGatewayDriver,
      gateway: {
        supergraphSdl: new IntrospectAndCompose({
          subgraphs: [
            { name: 'orders', url: process.env.ORDERS_URL },
            { name: 'customers', url: 'http://customers:4002/graphql' },
            { name: 'reviews', url: 'http://reviews.internal:4003/graphql' },
          ],
        }),
      },
    }),
  ],
})
export class AppModule {}
