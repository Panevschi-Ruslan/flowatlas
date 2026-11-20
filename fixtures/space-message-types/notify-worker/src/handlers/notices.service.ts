import { Injectable } from '@nestjs/common';

import type { CommentAdded, DocPublished, ExportFinished, MemberJoined } from './space-events';

/** What the handlers end up doing: the per-type work a dispatcher forwards to. */
@Injectable()
export class Notices {
  docPublished(event: DocPublished): void {
    void event.docId;
  }

  digest(event: MemberJoined | ExportFinished): void {
    void event.type;
  }

  comment(event: CommentAdded): void {
    void event.commentId;
  }
}
