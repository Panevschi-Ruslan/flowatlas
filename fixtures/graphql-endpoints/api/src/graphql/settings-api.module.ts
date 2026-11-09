import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { YogaDriver, type YogaDriverConfig } from '@graphql-yoga/nestjs';

import { settingsSchemaFactory } from './settings-schema.factory';

@Module({
  imports: [
    // The settings schema, at /settings: its options are a factory's.
    GraphQLModule.forRootAsync<YogaDriverConfig>({
      driver: YogaDriver,
      useFactory: settingsSchemaFactory,
    }),
  ],
})
export class SettingsApiModule {}
