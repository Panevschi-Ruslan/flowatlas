import { Injectable } from '@angular/core';
import { environment } from '../environments/environment';

/** The shop's ends of the three streams. */
@Injectable({ providedIn: 'root' })
export class LiveService {
  readonly seen: string[] = [];

  /** `onmessage` hears only frames named no event; every frame of this stream is `order-ready`. */
  watchReady(): void {
    const source = new EventSource(`${environment.ordersUrl}/orders/events`);
    source.onmessage = (frame) => this.onReady(frame);
  }

  /** Frames named no event, heard by `onmessage`. */
  watchFeed(): void {
    const source = new EventSource(`${environment.ordersUrl}/orders/feed`);
    source.onmessage = (frame) => this.onFeed(frame);
  }

  /** Frames named `notice`, listened for by that name. */
  watchNotices(): void {
    const source = new EventSource(`${environment.ordersUrl}/orders/notices`);
    source.addEventListener('notice', (frame) => this.onNotice(frame));
  }

  onReady(frame: MessageEvent): void {
    this.seen.push(String(frame.data));
  }

  onFeed(frame: MessageEvent): void {
    this.seen.push(String(frame.data));
  }

  onNotice(frame: MessageEvent): void {
    this.seen.push(String(frame.data));
  }
}
