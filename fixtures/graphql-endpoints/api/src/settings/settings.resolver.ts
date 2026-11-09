import { Args, Mutation, Query } from '@nestjs/graphql';

import { SettingsResolver } from '../graphql/scoped-resolver';
import { Operator, ShopSettings } from './settings.model';

@SettingsResolver()
export class ShopSettingsResolver {
  /** The operator signed in: a `me` of the settings schema, another field than the storefront's. */
  @Query(() => Operator)
  me(): Operator {
    return { id: 'o1', email: 'owner@example.com' };
  }

  @Query(() => ShopSettings)
  shopSettings(): ShopSettings {
    return { name: 'shop', currency: 'EUR' };
  }

  @Mutation(() => ShopSettings)
  renameShop(@Args('name') name: string): ShopSettings {
    return { name, currency: 'EUR' };
  }
}
