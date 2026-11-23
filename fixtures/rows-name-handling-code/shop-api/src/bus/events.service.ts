import { Injectable } from '@nestjs/common';
import { Subject, type Observable } from 'rxjs';

export interface BusFrame {
  channel: string;
  scopeId: string;
  data: unknown;
}

/**
 * The project's own in-process bus. `flowatlas.config.json` describes
 * `publish` as the producer and `subscribe` as the subscriber of one channel;
 * `all` hands out every frame of every channel, and names none.
 */
@Injectable()
export class EventsService {
  private readonly frames = new Subject<BusFrame>();

  publish(channel: string, scopeId: string, data: unknown): void {
    this.frames.next({ channel, scopeId, data });
  }

  subscribe(channel: string, handler: (data: unknown, scopeId: string) => void): () => void {
    const held = this.frames.subscribe((frame) => {
      if (frame.channel === channel) handler(frame.data, frame.scopeId);
    });
    return () => held.unsubscribe();
  }

  all(): Observable<{ scopeId: string; data: unknown }> {
    return this.frames.asObservable();
  }
}
