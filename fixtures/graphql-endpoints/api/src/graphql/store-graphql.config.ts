import { Injectable } from '@nestjs/common';
import { type GqlOptionsFactory } from '@nestjs/graphql';
import { type YogaDriverConfig } from '@graphql-yoga/nestjs';

import { ApiPath } from './api-path';
import { useRecordQueries } from './record-queries.plugin';

@Injectable()
export class StoreGraphqlConfig implements GqlOptionsFactory<YogaDriverConfig> {
  createGqlOptions(): YogaDriverConfig {
    return {
      autoSchemaFile: true,
      resolverScope: 'store',
      // The records each shop defines are answered by this plugin, not by a resolver.
      plugins: [useRecordQueries()],
      path: `/${ApiPath.Store}`,
    } as YogaDriverConfig;
  }
}
