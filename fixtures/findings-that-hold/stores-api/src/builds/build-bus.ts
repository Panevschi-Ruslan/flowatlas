import { Injectable } from '@nestjs/common';

/** The project's own bus for build progress, which `adapters.broker.custom` describes as a producer. */
@Injectable()
export class BuildBus {
  async publish(channel: string, payload: unknown): Promise<void> {
    void channel;
    void payload;
  }
}
