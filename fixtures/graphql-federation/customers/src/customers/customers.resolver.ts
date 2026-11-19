import { Args, Directive, ID, Query, ResolveReference, Resolver } from '@nestjs/graphql';

import { Customer } from './customer.model';
import { CustomersService } from './customers.service';

@Resolver(() => Customer)
export class CustomersResolver {
  constructor(private readonly customers: CustomersService) {}

  @Query(() => Customer, { nullable: true })
  customer(@Args('id', { type: () => ID }) id: string): Customer {
    return this.customers.byId(id);
  }

  @Query(() => [String])
  @Directive('@shareable')
  regions(): string[] {
    return this.customers.regions();
  }

  @ResolveReference()
  resolveReference(reference: { __typename: string; id: string }): Customer {
    return this.customers.byId(reference.id);
  }
}
