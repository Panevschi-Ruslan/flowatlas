import { Args, Field, ID, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';

@ObjectType()
export class Cart {
  @Field(() => ID)
  id: string;

  @Field()
  total: number;
}

@ObjectType()
export class Shopper {
  @Field(() => ID)
  id: string;

  @Field()
  email: string;
}

@Resolver()
export class StoreResolver {
  @Query(() => Cart)
  cart(): Cart {
    return { id: 'c1', total: 0 };
  }

  @Mutation(() => Shopper)
  signIn(@Args('email') email: string): Shopper {
    return { id: 's1', email };
  }
}
