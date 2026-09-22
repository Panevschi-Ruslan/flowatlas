import { Injectable } from '@nestjs/common';

/**
 * The house bus, as one service sees it.
 *
 * There is no broker library here for an adapter to detect: `publish` and
 * `pSubscribe` are ordinary methods, and `flowatlas.config.json` is what makes
 * them a producer and a subscriber. Each service carries its own client of the
 * same bus, which is how a project that has not extracted a shared package
 * actually looks.
 */
@Injectable()
export class EventBus {
  publish<T>(channel: string, payload: T): void {
    void channel;
    void payload;
  }

  pSubscribe<T>(pattern: string, handler: (payload: T) => void): void {
    void pattern;
    void handler;
  }
}
