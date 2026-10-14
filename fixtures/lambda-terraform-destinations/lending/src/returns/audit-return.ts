import type { EventBridgeEvent } from 'aws-lambda';

/** Audits each return, taken off the bus as the platform names a successful result. */
export const handler = async (event: EventBridgeEvent<'Lambda Function Invocation Result - Success', { responsePayload: unknown }>): Promise<void> => {
  console.log(event.source, event.detail.responsePayload);
};
