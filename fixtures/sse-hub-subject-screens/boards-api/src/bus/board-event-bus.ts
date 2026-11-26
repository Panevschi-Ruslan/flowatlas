import { Injectable } from '@nestjs/common';

import { BusService } from './bus.service';

/**
 * The publisher `flowatlas.config.json` describes as the producer. It hands
 * every message to the project's own bus, which is no broker the configuration
 * names - and which some code calls directly.
 */
@Injectable()
export class BoardEventBus {
  constructor(private readonly bus: BusService) {}

  publish(channel: string, message: unknown): Promise<void> {
    return this.bus.publish(channel, message);
  }
}
