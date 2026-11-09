import { Args, ID, Mutation, Query } from '@nestjs/graphql';

import { StoreResolver } from '../graphql/scoped-resolver';
import { Cart, Shopper } from './store.model';

@StoreResolver()
export class StorefrontResolver {
  /** The shopper signed in: a `me` of the storefront's schema. */
  @Query(() => Shopper)
  me(): Shopper {
    return { id: 's1', name: 'shopper' };
  }

  @Mutation(() => Cart)
  addToCart(@Args({ name: 'productId', type: () => ID }) productId: string): Cart {
    return { id: productId, items: 1 };
  }
}
