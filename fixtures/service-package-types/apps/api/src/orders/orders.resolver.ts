import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';

import { Order } from './order.model';
import { OrdersService } from './orders.service';

@Resolver(() => Order)
export class OrdersResolver {
  constructor(private readonly ordersService: OrdersService) {}

  @Query(() => [Order])
  orders(): Order[] {
    return this.ordersService.list();
  }

  @Mutation(() => Order)
  cancelOrder(@Args({ name: 'id', type: () => ID }) id: string): Order {
    return this.ordersService.cancel(id);
  }
}
