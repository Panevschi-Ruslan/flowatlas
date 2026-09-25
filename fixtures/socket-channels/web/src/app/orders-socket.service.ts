import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';

import { environment } from '../environments/environment';
import type { CancelOrder, OrderSummary, OrderUpdate } from './order-events';

/**
 * The browser end of the order socket.
 *
 * The namespace is written beside the settings key, which is why the reader can
 * work it out even though the whole address is only known at run time: the host
 * is the hole and the path is the source.
 */
@Injectable({ providedIn: 'root' })
export class OrdersSocketService {
  private readonly socket: Socket = io(`${environment.apiUrl}/orders`);

  latest: OrderUpdate | null = null;

  summary: OrderSummary | null = null;

  online = false;

  /** Publishes; the gateway's `@SubscribeMessage('order:cancel')` receives it. */
  cancel(command: CancelOrder): void {
    this.socket.emit('order:cancel', command);
  }

  /** Receives what the gateway publishes on the same namespace. */
  watch(): void {
    this.socket.on('order:updated', (update: OrderUpdate) => this.apply(update));
    this.socket.on('order:opened', (update: OrderUpdate) => this.apply(update));
    this.socket.on('order:closed', (update: OrderUpdate) => this.apply(update));
    // The library's own signal, not a channel anybody publishes to.
    this.socket.on('connect', () => this.markOnline());
  }

  /**
   * A request and a reply, not a publish.
   *
   * The third argument is where the answer arrives, so this end is `rpc` and
   * the chain carries straight on into `show` — the callback's body belongs to
   * the method that wrote it.
   */
  requestSummary(orderId: string): void {
    this.socket.emit('order:summary', orderId, (summary: OrderSummary) => this.show(summary));
  }

  /** Nobody can read the name, so this end of it cannot be joined either. */
  audit(event: string, update: OrderUpdate): void {
    this.socket.emit(event, update);
  }

  apply(update: OrderUpdate): void {
    this.latest = update;
  }

  show(summary: OrderSummary): void {
    this.summary = summary;
  }

  markOnline(): void {
    this.online = true;
  }
}
