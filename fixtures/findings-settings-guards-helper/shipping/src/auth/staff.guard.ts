import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';

/** Lets a request through only when it comes from a member of staff. */
@Injectable()
export class StaffGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
    return request.headers['x-staff-token'] !== undefined;
  }
}

/** Open on purpose: a route anyone may call. */
export const Public = () => SetMetadata('isPublic', true);

/** Switches the staff check off for one handler, saying nothing about why. */
export const SkipStaffCheck = () => SetMetadata('skipStaffCheck', true);
