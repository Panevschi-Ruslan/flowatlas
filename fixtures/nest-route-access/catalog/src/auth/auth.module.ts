import { DynamicModule, Module } from '@nestjs/common';

import { AUTH_GUARDS } from './guards';

@Module({})
export class AuthModule {
  static forRoot(): DynamicModule {
    return {
      module: AuthModule,
      providers: [...AUTH_GUARDS],
    };
  }
}
