import { Args, Parent, Query, ResolveField, ResolveReference, Resolver } from '@nestjs/graphql';

import { AccountsService, type User, type WishItem } from './accounts.service';

@Resolver()
export class AccountsResolver {
  constructor(private readonly accounts: AccountsService) {}

  @Query('me')
  me() {
    return this.accounts.current();
  }

  @Query('wishItem')
  wishItem(@Args('id') id: string) {
    return this.accounts.item(id);
  }
}

@Resolver('User')
export class UserResolver {
  constructor(private readonly accounts: AccountsService) {}

  @ResolveReference()
  resolveReference(reference: { id: string }) {
    return this.accounts.user(reference.id);
  }

  // What the router fetches for a WishItem's price below this User (@context(name: "viewer")).
  @ResolveField('currency')
  currency(@Parent() user: User) {
    return user.currency;
  }

  @ResolveField('email')
  email(@Parent() user: User) {
    return user.email;
  }

  @ResolveField('wishlist')
  wishlist(@Parent() user: User) {
    return this.accounts.wishlist(user.id);
  }
}

@Resolver('WishItem')
export class WishItemResolver {
  constructor(private readonly accounts: AccountsService) {}

  // The router fills currency from the nearest User above the item (@fromContext).
  @ResolveField('price')
  price(@Parent() item: WishItem, @Args('currency') currency: string) {
    return this.accounts.price(item.id, currency);
  }
}
