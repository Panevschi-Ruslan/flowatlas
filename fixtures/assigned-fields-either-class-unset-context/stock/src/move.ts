import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

const eventBridge = new EventBridgeClient({});

/** A stock move, announced on the bus. */
export const handler = async (event: { sku: string; quantity: number }) => {
  await eventBridge.send(new PutEventsCommand({ Entries: [{ EventBusName: 'stock-events', Source: 'stock', DetailType: 'StockMoved', Detail: JSON.stringify(event) }] }));
};
