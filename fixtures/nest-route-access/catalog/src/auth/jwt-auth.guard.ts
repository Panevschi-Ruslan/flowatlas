import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { IS_PUBLIC_KEY } from './public.decorator';
import { STRICT_KEY } from './strict.decorator';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
    const strict = this.reflector.get<boolean>(STRICT_KEY, context.getHandler());
    return strict ? request.headers['x-session'] !== undefined : request.headers['authorization'] !== undefined;
  }
}
