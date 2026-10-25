import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { SKIP_API_KEY } from './skip-api-key.decorator';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.reflector.get<boolean>(SKIP_API_KEY, context.getHandler())) return true;
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
    return request.headers['x-api-key'] !== undefined;
  }
}
