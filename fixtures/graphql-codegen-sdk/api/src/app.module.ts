import { Module } from '@nestjs/common';

import { SettingsService } from './config/settings';
import { configureApi } from './graphql/configure-api';
import { OfficeApiModule } from './office/office-api.module';
import { StatusServer } from './status/status.server';
import { StoreApiModule } from './store/store-api.module';

@Module({
  imports: [
    StoreApiModule,
    OfficeApiModule,
    configureApi((settings) => ({ apiType: 'store', apiPath: settings.api.storePath, resolverModule: StoreApiModule })),
    configureApi((settings) => ({ apiType: 'office', apiPath: settings.api.officePath, resolverModule: OfficeApiModule })),
  ],
  providers: [SettingsService, StatusServer],
})
export class AppModule {}
