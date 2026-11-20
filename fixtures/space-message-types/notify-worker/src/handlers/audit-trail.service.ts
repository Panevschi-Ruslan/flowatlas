import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { SpaceBus } from '../bus/space-bus.service';
import type { SpaceEvent } from './space-events';

type Handler = (event: SpaceEvent) => void;

/**
 * A record of handlers looked up by the type: an arrow and a bound method. A
 * type the record has no key for is dropped by `?.`, which is not a handler.
 */
@Injectable()
export class AuditTrail implements OnModuleInit {
  private readonly handlers: Partial<Record<SpaceEvent['type'], Handler>> = {
    DOC_PUBLISHED: (event) => this.recordPublish(event),
    MEMBER_JOINED: this.recordJoin.bind(this),
  };

  constructor(private readonly bus: SpaceBus) {}

  onModuleInit(): void {
    this.bus.subscribe('space:*:events', (event: SpaceEvent) => this.record(event));
  }

  record(event: SpaceEvent): void {
    this.handlers[event.type]?.(event);
  }

  recordPublish(event: SpaceEvent): void {
    void event;
  }

  recordJoin(event: SpaceEvent): void {
    void event;
  }
}
