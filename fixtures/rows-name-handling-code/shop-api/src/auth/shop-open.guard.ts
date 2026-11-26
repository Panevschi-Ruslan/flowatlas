import { CanActivate, Injectable, ServiceUnavailableException } from '@nestjs/common';

/** Lets a request through while the shop takes orders; refuses it with 503 otherwise. */
@Injectable()
export class ShopOpenGuard implements CanActivate {
  private open = true;

  canActivate(): boolean {
    if (!this.open) throw new ServiceUnavailableException('the shop is closed');
    return true;
  }
}
