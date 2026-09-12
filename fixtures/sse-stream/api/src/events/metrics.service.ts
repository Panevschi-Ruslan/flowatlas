import { Injectable } from '@nestjs/common';

/**
 * A second class with a method of the same name, deliberately.
 *
 * Nothing but the declared type of the receiver tells a subscription apart from
 * any other method called `pSubscribe`, so this is here to be ignored.
 */
@Injectable()
export class Metrics {
  async pSubscribe(pattern: string, handler: (message: string) => void): Promise<void> {
    void pattern;
    void handler;
  }
}
