import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { KinesisClient, PutRecordCommand } from '@aws-sdk/client-kinesis';

const dynamo = new DynamoDBClient({});
const kinesis = new KinesisClient({});
const eventBridge = new EventBridgeClient({});

/** A stock move: written to the ledger, put on the moves stream, and announced on the bus. */
export const handler = async (event: { sku: string; quantity: number }) => {
  await dynamo.send(new PutItemCommand({ TableName: 'stock-ledger', Item: { sku: { S: event.sku } } }));
  await kinesis.send(new PutRecordCommand({ StreamName: 'stock-moves', PartitionKey: event.sku, Data: Buffer.from(JSON.stringify(event)) }));
  await eventBridge.send(new PutEventsCommand({ Entries: [{ EventBusName: 'stock-events', Source: 'stock', DetailType: 'StockMoved', Detail: JSON.stringify(event) }] }));
};
