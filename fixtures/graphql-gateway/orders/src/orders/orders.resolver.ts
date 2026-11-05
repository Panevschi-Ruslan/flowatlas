import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';

import { CustomersService } from './customers.service';
import { GqlAuthGuard } from './gql-auth.guard';
import { Customer, Order, PlaceOrderInput } from './order.model';
import { OrdersService } from './orders.service';

@Resolver(() => Order)
@UseGuards(GqlAuthGuard)
export class OrdersResolver {
  constructor(
    private readonly orders: OrdersService,
    private readonly customers: CustomersService,
  ) {}

  @Query(() => [Order])
  orders(@Args('status', { nullable: true }) status?: string): Order[] {
    return this.orders.list(status);
  }

  @Query(() => Order, { name: 'order' })
  findOne(@Args({ name: 'id', type: () => ID }) id: string): Order {
    return this.orders.byId(id);
  }

  @Mutation(() => Order)
  placeOrder(@Args('input') input: PlaceOrderInput): Order {
    return this.orders.place(input);
  }

  @ResolveField(() => Customer)
  customer(@Parent() order: Order): Customer {
    return this.customers.byId(order.customerId);
  }
}
