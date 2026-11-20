import { Injectable } from '@nestjs/common';

import { SpaceBus } from '../bus/space-bus.service';
import { SPACE_EVENTS, SpaceEventType, exportFinished, type CommentAdded, type SpaceEvent } from './space-events';

/**
 * One channel per space, many kinds of message on it. Each publish writes its
 * type a different way, and each is read.
 */
@Injectable()
export class SpacesService {
  constructor(private readonly bus: SpaceBus) {}

  /** Written in place: `DOC_PUBLISHED`. */
  publishDoc(spaceId: string, docId: string): void {
    this.bus.publish(`space:${spaceId}:events`, { type: 'DOC_PUBLISHED', docId });
  }

  /** A typed constant whose type is an enum member: `COMMENT_ADDED`. */
  addComment(spaceId: string, docId: string, commentId: string): void {
    const event: CommentAdded = { type: SpaceEventType.CommentAdded, docId, commentId };
    this.bus.publish(`space:${spaceId}:events`, event);
  }

  /** A member of a constant object: `MEMBER_JOINED`. */
  join(spaceId: string, memberId: string): void {
    this.bus.publish(`space:${spaceId}:events`, { type: SPACE_EVENTS.memberJoined, memberId });
  }

  /** Built by a helper whose answer is written out: `EXPORT_FINISHED`. */
  finishExport(spaceId: string, jobId: string, url: string): void {
    this.bus.publish(`space:${spaceId}:events`, exportFinished(jobId, url));
  }

  /** Published, and selected by no code that runs: `QUOTA_WARNING`. */
  warnQuota(spaceId: string, usedBytes: number): void {
    this.bus.publish(`space:${spaceId}:events`, { type: 'QUOTA_WARNING', usedBytes });
  }

  /**
   * Any member of the union, decided by whoever calls: the type is not fixed
   * here, so the publish is drawn onto its channel and a row says why it is on
   * no type.
   */
  relay(spaceId: string, event: SpaceEvent): void {
    this.bus.publish(`space:${spaceId}:events`, event);
  }
}
