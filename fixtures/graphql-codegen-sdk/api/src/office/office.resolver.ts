import { Args, Field, ID, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';

@ObjectType()
export class Staff {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;
}

@Resolver()
export class OfficeResolver {
  @Query(() => [Staff])
  staff(): Staff[] {
    return [];
  }

  @Mutation(() => Staff)
  signIn(@Args('email') email: string): Staff {
    return { id: 'a1', name: email };
  }
}
