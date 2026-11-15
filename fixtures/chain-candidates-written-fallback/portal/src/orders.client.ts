import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Requests rooted at keys a settings factory builds from variables
 * (`settings.ts`): each key is claimed by whoever claims its variable, the
 * keys after the first as much as the first.
 */
@Injectable()
export class OrdersClient {
  constructor(private readonly config: ConfigService) {}

  /** `orders.url`, else `legacy.url`: only legacy serves it, behind the second key's variable. */
  archived() {
    return fetch(`${this.config.get('orders.url') || this.config.get('legacy.url')}/archive`);
  }

  /** One of the two keys by a condition nobody settles: only archive serves it. */
  exports(isProd: boolean) {
    return fetch(`${isProd ? this.config.get('orders.url') : this.config.get('legacy.url')}/exports`);
  }
}
