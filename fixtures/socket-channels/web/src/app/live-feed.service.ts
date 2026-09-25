import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';

import { environment, feedNamespace } from '../environments/environment';
import type { OrderUpdate } from './order-events';

/**
 * A socket whose namespace is decided by the deployment.
 *
 * The event name below is a plain literal, and on its own it would resolve. It
 * is the endpoint that is missing: the hole sits inside the path, so nothing
 * says which namespace `order:updated` here belongs to, and putting it on the
 * root namespace's node would claim this listens to a gateway it may not.
 */
@Injectable({ providedIn: 'root' })
export class LiveFeedService {
  private readonly socket: Socket = io(`${environment.apiUrl}/${feedNamespace}`);

  latest: OrderUpdate | null = null;

  watch(): void {
    this.socket.on('order:updated', (update: OrderUpdate) => this.apply(update));
  }

  apply(update: OrderUpdate): void {
    this.latest = update;
  }
}
