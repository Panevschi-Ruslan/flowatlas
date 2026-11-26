import { Field, ObjectType, Query } from '@nestjs/graphql';

import { SettingsResolver } from '../graphql/scoped-resolver';

@ObjectType()
export class ShippingZone {
  @Field()
  code: string;
}

@SettingsResolver(() => ShippingZone)
export class ShippingResolver {
  @Query(() => [ShippingZone])
  shippingZones(): ShippingZone[] {
    return [{ code: 'eu' }];
  }
}
