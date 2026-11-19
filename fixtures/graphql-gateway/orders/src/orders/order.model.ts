import { Field, Float, ID, InputType, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class Customer {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;
}

@ObjectType()
export class Order {
  @Field(() => ID)
  id: string;

  @Field(() => Float)
  total: number;

  @Field({ nullable: true })
  note?: string;

  customerId: string;
}

@InputType()
export class PlaceOrderInput {
  @Field(() => ID)
  customerId: string;

  @Field(() => Float)
  total: number;
}
