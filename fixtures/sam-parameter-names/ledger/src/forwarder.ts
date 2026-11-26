import { KinesisClient, PutRecordCommand } from '@aws-sdk/client-kinesis';

const kinesis = new KinesisClient({});

interface Change {
  eventName: string;
  dynamodb: { NewImage: Record<string, { S?: string; N?: string }> };
}

/** Every entry added to the ledger, put on the change stream in order. */
export const handler = async (event: { Records: Change[] }) => {
  const records = event.Records.filter((change) => change.eventName === 'INSERT').map((change) => {
    const image = change.dynamodb.NewImage;
    return {
      StreamName: process.env.CHANGE_STREAM,
      PartitionKey: image.id.S,
      Data: Buffer.from(JSON.stringify({ id: image.id.S, team: image.team.S, amount: Number(image.amount.N) })),
    };
  });
  for (const record of records) {
    await kinesis.send(new PutRecordCommand(record));
  }
};
