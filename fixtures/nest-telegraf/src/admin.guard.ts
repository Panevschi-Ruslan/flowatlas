import { CanActivate, Injectable } from '@nestjs/common';

/** Attached to one bot handler, to prove the generic guard pass reaches entries of any kind. */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}
