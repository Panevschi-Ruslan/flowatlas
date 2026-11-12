import { Field, ID, ObjectType } from '@nestjs/graphql';

/** The shape the back office imports by the API package's name, for its type. */
@ObjectType()
export class Order {
  @Field(() => ID)
  id: string;

  @Field()
  status: string;
}
