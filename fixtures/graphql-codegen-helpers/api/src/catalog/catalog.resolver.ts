import { Args, Field, ID, Mutation, ObjectType, Query, Subscription } from '@nestjs/graphql';

import { StoreResolver } from '../graphql/scoped-resolver';

@ObjectType()
export class Product {
  @Field(() => ID)
  id: string;

  @Field()
  title: string;

  @Field()
  price: number;
}

@StoreResolver(() => Product)
export class CatalogResolver {
  @Query(() => [Product])
  products(@Args('first', { nullable: true }) first?: number): Product[] {
    return [{ id: 'p1', title: 'mug', price: first ?? 1 }];
  }

  @Query(() => Product)
  product(@Args('id') id: string): Product {
    return { id, title: 'mug', price: 1 };
  }

  @Mutation(() => Product)
  renameProduct(@Args('id') id: string, @Args('title') title: string): Product {
    return { id, title, price: 1 };
  }

  @Subscription(() => Product)
  productChanged(): Product {
    return { id: 'p1', title: 'mug', price: 1 };
  }
}
