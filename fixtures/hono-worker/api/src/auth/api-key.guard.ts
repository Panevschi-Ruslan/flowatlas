import type { CanActivate, ExecutionContext } from '@nestjs/common';

/**
 * Installed for the whole Nest application, so every controller route carries
 * it. The worker's own routes are answered before Nest is asked anything, so
 * none of them may: drawing it there would call a route protected by a check
 * that never runs.
 */
export class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    return context.getType() === 'http';
  }
}
