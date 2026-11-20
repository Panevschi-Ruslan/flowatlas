/**
 * Every kind of message one channel carries, told apart by `type`: a
 * discriminated union, each member fixing its own literal.
 */
export enum SpaceEventType {
  CommentAdded = 'COMMENT_ADDED',
}

export const SPACE_EVENTS = {
  memberJoined: 'MEMBER_JOINED',
} as const;

export interface DocPublished {
  type: 'DOC_PUBLISHED';
  docId: string;
}

export interface CommentAdded {
  type: SpaceEventType.CommentAdded;
  docId: string;
  commentId: string;
}

export interface MemberJoined {
  type: typeof SPACE_EVENTS.memberJoined;
  memberId: string;
}

export interface ExportFinished {
  type: 'EXPORT_FINISHED';
  jobId: string;
  url: string;
}

export interface QuotaWarning {
  type: 'QUOTA_WARNING';
  usedBytes: number;
}

export type SpaceEvent = DocPublished | CommentAdded | MemberJoined | ExportFinished | QuotaWarning;

