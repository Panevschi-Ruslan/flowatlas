import { Field, ID, Int, ObjectType, Query, Resolver } from '@nestjs/graphql';

@ObjectType()
export class Review {
  @Field(() => ID)
  id: string;

  @Field(() => Int)
  stars: number;
}

@Resolver()
export class ReviewsResolver {
  @Query(() => [Review])
  reviews(): Review[] {
    return [];
  }
}
