import { SetMetadata } from '@nestjs/common';

/** The flag `JwtAuthGuard` reads to let a request through. */
export const IS_PUBLIC_KEY = 'isPublic';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
