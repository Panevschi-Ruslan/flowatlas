import { Field, ID, ObjectType, Query, Resolver } from '@nestjs/graphql';

@ObjectType()
export class Store {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;
}

@Resolver()
export class StoresResolver {
  @Query(() => [Store])
  stores(): Store[] {
    return [];
  }
}
