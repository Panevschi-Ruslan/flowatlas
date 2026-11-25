import { Injectable } from '@nestjs/common';

/**
 * The project's own bus. No broker library: `flowatlas.config.json` describes
 * `publish` and `subscribe` as the producer and the subscriber.
 */
@Injectable()
export class VenueBus {
  publish<T>(channel: string, message: T): void {
    void channel;
    void message;
  }

  subscribe<T>(channel: string, handler: (message: T) => void): void {
    void channel;
    void handler;
  }
}
