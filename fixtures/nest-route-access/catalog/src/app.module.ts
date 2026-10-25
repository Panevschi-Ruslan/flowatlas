import { Module } from '@nestjs/common';

import { AuthModule } from './auth/auth.module';
import { ProductsModule } from './products/products.module';

/**
 * The application-wide guard is not written here, nor in any `@Module`: it is
 * returned by `AuthModule.forRoot()`, from an array declared in another file.
 * Expected: every route of this service behind `JwtAuthGuard`, `where: global`,
 * `via: APP_GUARD in AuthModule.forRoot`.
 */
@Module({
  imports: [AuthModule.forRoot(), ProductsModule],
})
export class AppModule {}
