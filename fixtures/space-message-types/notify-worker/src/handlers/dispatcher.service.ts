import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { SpaceBus } from '../bus/space-bus.service';
import { Notices } from './notices.service';
import { SpaceEventType, type CommentAdded, type SpaceEvent } from './space-events';

/**
 * The channel arrives at one method, which chooses by `type` in a switch: each
 * case is its own handler, one call deep. `default` does nothing, so the
 * dispatcher hands no other type on.
 */
@Injectable()
export class SpaceEventsDispatcher implements OnModuleInit {
  constructor(
    private readonly bus: SpaceBus,
    private readonly notices: Notices,
  ) {}

  onModuleInit(): void {
    this.bus.subscribe('space:*:events', (event: SpaceEvent) => this.dispatch(event));
  }

  dispatch(event: SpaceEvent): void {
    switch (event.type) {
      case 'DOC_PUBLISHED':
        return this.notices.docPublished(event);
      case SpaceEventType.CommentAdded:
        return this.onComment(event);
      case 'MEMBER_JOINED':
      case 'EXPORT_FINISHED':
        return this.notices.digest(event);
      default:
        return;
    }
  }

  onComment(event: CommentAdded): void {
    this.notices.comment(event);
  }
}
