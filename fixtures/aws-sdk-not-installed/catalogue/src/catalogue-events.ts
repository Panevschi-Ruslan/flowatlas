import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { sns } from './clients';

export interface CatalogueItem {
  itemId: string;
  title: string;
  shelfMark: string;
}

/**
 * The same three clients the installed fixture uses, with nothing installed:
 * every one of them is `any` to the checker, and each is read from what the
 * source says it is constructed from.
 */
export class CatalogueEvents {
  // A class property initialised with a construction.
  private readonly client = new EventBridgeClient({ region: 'eu-west-1' });

  async catalogued(item: CatalogueItem): Promise<void> {
    await this.client.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: 'library-events',
            Source: 'library.catalogue',
            DetailType: 'ItemCatalogued',
            Detail: JSON.stringify(item),
          },
        ],
      }),
    );
  }
}

/** A parameter annotated with the client's class. */
export const queueForShelving = async (sqs: SQSClient, item: CatalogueItem): Promise<void> => {
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: 'https://sqs.eu-west-1.amazonaws.com/111122223333/library-shelving',
      MessageBody: JSON.stringify(item),
    }),
  );
};

/** Version 2, constructed in another module through a namespace import. */
export const announceWithdrawal = async (itemId: string): Promise<void> => {
  await sns
    .publish({
      TopicArn: 'arn:aws:sns:eu-west-1:111122223333:catalogue-withdrawals',
      Message: JSON.stringify({ itemId }),
    })
    .promise();
};
