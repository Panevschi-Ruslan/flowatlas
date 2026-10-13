import type { SQSEvent } from 'aws-lambda';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import type { ReturnedItem } from '../lib/returns-queue';

const sns = new SNSClient({ region: 'eu-west-1' });
const events = new EventBridgeClient({ region: 'eu-west-1' });

/** The topic a return is announced on where the deployment names none. */
const ITEM_RETURNED_TOPIC = 'arn:aws:sns:eu-west-1:123456789012:library-item-returned';

/** The bus a return is put on: the deployment's where it says, the library's otherwise. */
const BUS = process.env.EVENT_BUS_NAME || 'library-events';

/**
 * Reads the returns queue, announces each return on a topic and puts it on a
 * bus. Its deployment names the bus and leaves the topic to the default.
 */
export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) {
    const item = JSON.parse(record.body) as ReturnedItem;
    await sns.send(
      new PublishCommand({
        TopicArn: process.env.ITEM_RETURNED_TOPIC_ARN ?? ITEM_RETURNED_TOPIC,
        Message: JSON.stringify(item),
      }),
    );
    await events.send(
      new PutEventsCommand({
        Entries: [{ EventBusName: BUS, Source: 'library.returns', DetailType: 'ItemReturned', Detail: JSON.stringify(item) }],
      }),
    );
  }
};
