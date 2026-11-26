import { Injectable } from '@nestjs/common';

/** The project's own bus: the configuration describes `publish` as a producer. */
@Injectable()
export class EventBus {
  private readonly outbox: Array<{ channel: string; message: unknown }> = [];

  async publish(channel: string, message: unknown): Promise<void> {
    this.outbox.push({ channel, message });
  }
}
