import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { YogaDriver, type YogaDriverConfig } from '@graphql-yoga/nestjs';

import { AdminModule } from '../admin/admin.module';
import { ApiPath } from './api-path';

@Module({
  imports: [
    // The operators' schema, at /admin: the resolvers of the module it includes.
    GraphQLModule.forRoot<YogaDriverConfig>({
      driver: YogaDriver,
      autoSchemaFile: true,
      include: [AdminModule],
      path: `/${ApiPath.Admin}`,
    }),
    AdminModule,
  ],
})
export class AdminApiModule {}
