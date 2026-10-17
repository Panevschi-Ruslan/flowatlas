import { Injectable } from '@nestjs/common';
import { SendMessageBatchCommand, SQSClient } from '@aws-sdk/client-sqs';

const BATCH_SIZE = 10;

const EXPORTS_QUEUE_URL = 'https://sqs.eu-west-1.amazonaws.com/111122223333/parcel-exports';

@Injectable()
export class ParcelExport {
  private readonly sqs = new SQSClient({ region: 'eu-west-1' });

  // Ten ids at a time, each ten one batch: bounded by its chunks.
  async exportAll(ids: string[]): Promise<void> {
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      await this.sqs.send(
        new SendMessageBatchCommand({
          QueueUrl: EXPORTS_QUEUE_URL,
          Entries: ids.slice(i, i + BATCH_SIZE).map((id) => ({ Id: id, MessageBody: id })),
        }),
      );
    }
  }

  // Groups made elsewhere, one batch each: bounded because every call it makes is a batch.
  async exportGroups(groups: string[][]): Promise<void> {
    for (const group of groups) {
      await this.sqs.send(
        new SendMessageBatchCommand({
          QueueUrl: EXPORTS_QUEUE_URL,
          Entries: group.map((id) => ({ Id: id, MessageBody: id })),
        }),
      );
    }
  }
}
