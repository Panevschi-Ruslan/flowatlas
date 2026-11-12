import { Int, Query, Resolver } from '@nestjs/graphql';

/** Tagged for no schema, and in no module a schema includes: no endpoint serves it. */
@Resolver()
export class ReportsResolver {
  @Query(() => Int)
  ordersToday(): number {
    return 0;
  }
}
