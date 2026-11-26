import { Injectable } from '@nestjs/common';
import { CallsService } from '@flowatlas/markers';
import { Subject, type Observable } from 'rxjs';

import { transportsFor } from './routes';

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
    if (transportsFor(channel).has('bot')) void this.relayToBot(channel, scopeId, data);
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

  /** Posted to the bot, which reads the channel's messages there. */
  @CallsService('bot', 'POST /events/relay')
  private async relayToBot(channel: string, scopeId: string, message: unknown): Promise<void> {
    void channel;
    void scopeId;
    void message;
  }
}
