import { CanActivate, Injectable } from '@nestjs/common';

@Injectable()
export class GqlAuthGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}
