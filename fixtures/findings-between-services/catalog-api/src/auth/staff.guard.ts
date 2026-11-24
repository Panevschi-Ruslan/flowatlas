import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

interface StaffRequest {
  headers: Record<string, string | undefined>;
}

/** Lets a request through when it carries a staff token. */
@Injectable()
export class StaffGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<StaffRequest>();
    return request.headers['x-staff-token'] !== undefined;
  }
}
