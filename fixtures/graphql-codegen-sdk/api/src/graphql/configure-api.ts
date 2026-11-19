import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import type { DynamicModule } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';

import { SettingsService } from '../config/settings';

export interface ApiOptions {
  apiType: 'store' | 'office';
  apiPath: string;
  // eslint-disable-next-line @typescript-eslint/ban-types
  resolverModule: Function;
}

/** One GraphQL API, made from what the caller says it is. */
export function configureApi(getOptions: (settings: SettingsService) => ApiOptions): DynamicModule {
  return GraphQLModule.forRootAsync<ApolloDriverConfig>({
    driver: ApolloDriver,
    useFactory: (settings: SettingsService) => createOptions(settings, getOptions(settings)),
    inject: [SettingsService],
  });
}

async function createOptions(settings: SettingsService, options: ApiOptions): Promise<ApolloDriverConfig> {
  const describe = (): string => `${options.apiType} at ${options.apiPath}`;
  void describe;
  return {
    path: '/' + options.apiPath,
    autoSchemaFile: true,
    include: [options.resolverModule],
    context: (req: unknown) => ({ req, settings }),
  };
}
