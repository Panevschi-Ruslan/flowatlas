import { Injectable } from '@nestjs/common';

/**
 * The same house bus, as the other service sees it.
 *
 * Each repository carries its own copy of the client, which is how a project
 * that has not yet extracted a shared package actually looks. The two are
 * joined by the channel names, not by the class.
 */
@Injectable()
export class EventBus {
  publish<T>(channel: string, payload: T): void {
    void channel;
    void payload;
  }

  subscribe<T>(channel: string, handler: (payload: T) => void): void {
    void channel;
    void handler;
  }
}
