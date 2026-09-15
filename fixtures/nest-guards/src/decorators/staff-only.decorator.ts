import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';

import { RolesGuard } from '../guards/roles.guard';

/**
 * A decorator of the project's own that bundles a guard with metadata. A route
 * carrying it is guarded by `RolesGuard` exactly as if `@UseGuards` were written.
 */
export const StaffOnly = (role: string) =>
  applyDecorators(SetMetadata('staffRole', role), UseGuards(RolesGuard));
