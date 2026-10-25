import { SetMetadata } from '@nestjs/common';

/**
 * Also a flag set to `true` that `JwtAuthGuard` reads, but one that holds a
 * request to more, not less. Expected: not an opt-out; the guard stays on.
 */
export const STRICT_KEY = 'strictSession';

export const Strict = () => SetMetadata(STRICT_KEY, true);
