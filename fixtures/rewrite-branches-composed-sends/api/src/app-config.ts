import type { AppConfig } from './config/settings';

/** The application's own configuration: it moves the store API off its default path. */
export const config: AppConfig = {
  apiOptions: {
    storePath: 'shop-graphql',
  },
};
