import type { EventBridgeEvent } from 'aws-lambda';

export interface CoverUploaded {
  bucket: { name: string };
  object: { key: string };
}

const covers: string[] = [];

/** Takes the storage service's own events: a way in from outside the project, with no publisher in it. */
export const handler = async (event: EventBridgeEvent<'Object Created', CoverUploaded>): Promise<void> => {
  covers.push(event.detail.object.key);
};
