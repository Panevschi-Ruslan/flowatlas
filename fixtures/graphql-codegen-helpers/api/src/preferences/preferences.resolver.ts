import { Args, Field, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';

@ObjectType()
export class Preferences {
  @Field()
  currency: string;

  @Field()
  smtpEnabled: boolean;
}

/** No scope written: the library's patch gives it the settings schema. */
@Resolver(() => Preferences)
export class PreferencesResolver {
  @Query(() => Preferences)
  preferences(): Preferences {
    return { currency: 'EUR', smtpEnabled: false };
  }

  @Mutation(() => Preferences)
  toggleSMTP(@Args('enabled') enabled: boolean): Preferences {
    return { currency: 'EUR', smtpEnabled: enabled };
  }
}
