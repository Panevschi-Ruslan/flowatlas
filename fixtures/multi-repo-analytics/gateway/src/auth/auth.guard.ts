import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * The reason `guarded_by` is walked when collecting configuration keys.
 *
 * `JWT_SECRET` is read here and nowhere else, so a flow that lists only what
 * its handlers read would say the flow needs no secret at all.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const secret = this.config.get('JWT_SECRET');
    return typeof secret === 'string' && context.getHandler() !== undefined;
  }
}
