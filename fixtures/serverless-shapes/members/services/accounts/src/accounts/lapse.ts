import type { SNSEvent } from 'aws-lambda';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

const events = new EventBridgeClient({ region: 'eu-central-1' });

/** Subscribed to the lapsed topic: says on the default bus that a membership lapsed, which the notices service takes. */
export const handler = async (event: SNSEvent): Promise<void> => {
  await events.send(
    new PutEventsCommand({ Entries: [{ Source: 'club.accounts', DetailType: 'MemberLapsed', Detail: event.Records[0]?.Sns.Message ?? '{}' }] }),
  );
};
