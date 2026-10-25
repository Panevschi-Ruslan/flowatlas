import { APP_GUARD } from '@nestjs/core';

import { JwtAuthGuard } from './jwt-auth.guard';

/** Spread into `AuthModule.forRoot()`'s providers: an array assembled in a file of its own. */
export const AUTH_GUARDS = [{ provide: APP_GUARD, useClass: JwtAuthGuard }];
