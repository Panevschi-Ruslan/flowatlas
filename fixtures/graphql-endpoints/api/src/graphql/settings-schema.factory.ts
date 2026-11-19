import { type YogaDriverConfig } from '@graphql-yoga/nestjs';

import { ApiPath } from './api-path';

export const settingsSchemaFactory = async (): Promise<YogaDriverConfig> => {
  const config = {
    autoSchemaFile: true,
    resolverScope: 'settings',
    path: `/${ApiPath.Settings}`,
  } as YogaDriverConfig;

  return config;
};
