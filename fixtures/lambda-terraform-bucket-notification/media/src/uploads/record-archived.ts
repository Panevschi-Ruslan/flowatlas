import type { EventBridgeEvent } from 'aws-lambda';

/** Run by the rule on the default bus that takes `Object Created` from the archive bucket. */
export const handler = async (event: EventBridgeEvent<'Object Created', { object: { key: string } }>): Promise<void> => {
  console.log('archived', event.detail.object.key);
};
