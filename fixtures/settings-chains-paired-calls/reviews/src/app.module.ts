import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { YogaDriver, type YogaDriverConfig } from '@graphql-yoga/nestjs';

import { ReviewsResolver } from './reviews.resolver';

@Module({
  imports: [
    GraphQLModule.forRoot<YogaDriverConfig>({
      driver: YogaDriver,
      autoSchemaFile: true,
      path: '/reviews-api',
    }),
  ],
  providers: [ReviewsResolver],
})
export class AppModule {}
