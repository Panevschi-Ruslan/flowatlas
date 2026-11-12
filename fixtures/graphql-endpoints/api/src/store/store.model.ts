import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class Shopper {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;
}

@ObjectType()
export class Cart {
  @Field(() => ID)
  id: string;

  @Field(() => Int)
  items: number;
}
