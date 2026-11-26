import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { SpaceBus } from '../bus/space-bus.service';

/** Open connections to browsers, each sent every message as it is. */
@Injectable()
export class Clients {
  broadcast(message: unknown): void {
    void message;
  }
}

/**
 * Forwards every message on the channel to the browsers without reading its
 * type: a consumer of every type alike, and the handler of none.
 */
@Injectable()
export class StreamRelay implements OnModuleInit {
  constructor(
    private readonly bus: SpaceBus,
    private readonly clients: Clients,
  ) {}

  onModuleInit(): void {
    this.bus.subscribe('space:*:events', (message: unknown) => this.forward(message));
  }

  forward(message: unknown): void {
    this.clients.broadcast(message);
  }
}
