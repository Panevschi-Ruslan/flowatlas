import { Field, ID, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class Operator {
  @Field(() => ID)
  id: string;

  @Field()
  email: string;
}

@ObjectType()
export class ShopSettings {
  @Field()
  name: string;

  @Field()
  currency: string;
}
