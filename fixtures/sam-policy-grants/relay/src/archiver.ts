import { KinesisClient, PutRecordCommand } from '@aws-sdk/client-kinesis';

const kinesis = new KinesisClient({});

const streams = new Map<string, string>();

/** Each order onto the stream registered for its region when the container started. */
export const handler = async (event: { region: string; order: { id: string } }) => {
  await kinesis.send(
    new PutRecordCommand({ StreamName: streams.get(event.region), PartitionKey: event.order.id, Data: Buffer.from(JSON.stringify(event.order)) }),
  );
};

export const register = (region: string, stream: string): void => {
  streams.set(region, stream);
};
