import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

/** Says no by returning false: a 403, refused before any interceptor runs. */
@Injectable()
export class MemberGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    return request.headers['x-member'] !== undefined;
  }
}
