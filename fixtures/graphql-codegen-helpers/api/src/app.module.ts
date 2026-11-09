import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { YogaDriver, type YogaDriverConfig } from '@graphql-yoga/nestjs';

import { CatalogResolver } from './catalog/catalog.resolver';
import { PreferencesResolver } from './preferences/preferences.resolver';
import { ShippingResolver } from './preferences/shipping.resolver';

@Module({
  imports: [
    GraphQLModule.forRoot<YogaDriverConfig>({ driver: YogaDriver, path: '/graphql', schemaScope: 'store' }),
    GraphQLModule.forRoot<YogaDriverConfig>({ driver: YogaDriver, path: '/settings', schemaScope: 'settings' }),
  ],
  providers: [CatalogResolver, PreferencesResolver, ShippingResolver],
})
export class AppModule {}
