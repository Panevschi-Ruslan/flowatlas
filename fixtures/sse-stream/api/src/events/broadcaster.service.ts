import { Injectable } from '@nestjs/common';
import type { EventPublisher } from './event-publisher';
import type { DepotEvent } from './depot-event';

/**
 * The transport the house bus is built on: no library, so no adapter can detect
 * it and the configuration has to describe it. Publishing is a call and so is
 * receiving — `pSubscribe` takes the pattern and what to run when a message
 * matching it arrives.
 */
@Injectable()
export class Broadcaster implements EventPublisher {
  private readonly listeners: Array<{ pattern: string; handler: Handler }> = [];

  async publish(channel: string, event: DepotEvent): Promise<void> {
    for (const { pattern, handler } of this.listeners) {
      if (matches(pattern, channel)) handler(JSON.stringify(event), channel);
    }
  }

  async pSubscribe(pattern: string, handler: Handler): Promise<void> {
    this.listeners.push({ pattern, handler });
  }
}

type Handler = (message: string, channel: string) => void;

/** `*` stands for one segment of the channel name, as it does on the wire. */
const matches = (pattern: string, channel: string): boolean =>
  new RegExp(`^${pattern.split('*').join('[^:]*')}$`).test(channel);
