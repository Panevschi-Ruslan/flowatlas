import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { YogaDriver, type YogaDriverConfig } from '@graphql-yoga/nestjs';

import { AdminApiModule } from './graphql/admin-api.module';
import { SettingsApiModule } from './graphql/settings-api.module';
import { StoreGraphqlConfig } from './graphql/store-graphql.config';
import { ReportsModule } from './reports/reports.module';
import { SettingsModule } from './settings/settings.module';
import { StoreModule } from './store/store.module';

@Module({
  imports: [
    // The storefront's schema, at /graphql: its options are a class's.
    GraphQLModule.forRootAsync<YogaDriverConfig>({
      driver: YogaDriver,
      useClass: StoreGraphqlConfig,
    }),
    SettingsApiModule,
    AdminApiModule,
    StoreModule,
    SettingsModule,
    ReportsModule,
  ],
})
export class AppModule {}
