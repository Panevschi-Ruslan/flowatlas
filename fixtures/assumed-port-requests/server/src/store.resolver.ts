import { Args, Field, ID, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';

@ObjectType()
export class Product {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;
}

@ObjectType()
export class Cart {
  @Field(() => ID)
  id: string;
}

@Resolver()
export class StoreResolver {
  @Query(() => [Product])
  products(): Product[] {
    return [];
  }

  @Mutation(() => Cart)
  addToCart(@Args('productId', { type: () => ID }) productId: string): Cart {
    return { id: productId };
  }
}
