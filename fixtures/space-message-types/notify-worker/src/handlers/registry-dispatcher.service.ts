import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { SpaceBus } from '../bus/space-bus.service';
import type { SpaceEvent } from './space-events';
import { HandlerRegistry } from './welcome.handlers';

/**
 * Looks the handler up by the type in a registry filled when the code runs.
 * Nothing here says which; the decorator naming the type on a method is what
 * does, and is drawn as a guess.
 */
@Injectable()
export class RegistryDispatcher implements OnModuleInit {
  constructor(
    private readonly bus: SpaceBus,
    private readonly registry: HandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.bus.subscribe('space:*:events', (event: SpaceEvent) => this.route(event));
  }

  route(event: SpaceEvent): void {
    const handler = this.registry.find(event.type);
    handler?.(event);
  }
}
