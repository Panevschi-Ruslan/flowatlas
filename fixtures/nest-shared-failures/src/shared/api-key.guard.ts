import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

/** In front of every route: a missing key is a 401, a wrong one a refusal. */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const key = request.headers['x-api-key'];
    if (key === undefined) throw new UnauthorizedException('an api key is required');
    return key === 'demo-key';
  }
}
