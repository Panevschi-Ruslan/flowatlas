import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { SpaceBus } from '../bus/space-bus.service';

interface Envelope {
  type: string;
  docId?: string;
}

/**
 * An `if` and the `else if` after it, on a message typed loosely. One of the
 * types it chooses, `DOC_ARCHIVED`, nothing publishes.
 */
@Injectable()
export class ActivityFeed implements OnModuleInit {
  constructor(private readonly bus: SpaceBus) {}

  onModuleInit(): void {
    this.bus.subscribe('space:*:events', (message: Envelope) => this.onMessage(message));
  }

  onMessage(message: Envelope): void {
    const { type } = message;
    if (type === 'COMMENT_ADDED') {
      this.pushComment(message);
    } else if (type === 'DOC_ARCHIVED') {
      this.pushArchive(message);
    }
  }

  pushComment(message: Envelope): void {
    void message.docId;
  }

  pushArchive(message: Envelope): void {
    void message.docId;
  }
}
