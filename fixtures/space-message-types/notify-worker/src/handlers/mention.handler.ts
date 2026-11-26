import { Injectable } from '@nestjs/common';

import type { SpaceEvent } from './space-events';

/**
 * The other trap: a method that checks the type and is reached by nothing - no
 * subscription, no module, no caller. It is not a consumer of anything, so no
 * type is drawn onto it, and `dead` still says so.
 */
@Injectable()
export class MentionHandler {
  handle(event: SpaceEvent): void {
    if (event.type !== 'COMMENT_ADDED') return;
    void event.commentId;
  }
}
