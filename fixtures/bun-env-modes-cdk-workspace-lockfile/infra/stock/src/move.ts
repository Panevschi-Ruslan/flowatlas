import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { KinesisClient, PutRecordCommand } from '@aws-sdk/client-kinesis';

const dynamo = new DynamoDBClient({});
const kinesis = new KinesisClient({});

/** A stock move: written to the ledger and put on the moves stream. */
export const handler = async (event: { sku: string; quantity: number }) => {
  await dynamo.send(new PutItemCommand({ TableName: 'stock-ledger', Item: { sku: { S: event.sku } } }));
  await kinesis.send(new PutRecordCommand({ StreamName: 'stock-moves', PartitionKey: event.sku, Data: Buffer.from(JSON.stringify(event)) }));
};
