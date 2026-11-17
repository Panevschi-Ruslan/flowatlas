import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

const eventBridge = new EventBridgeClient({});

/** A stock count, announced on the bus. */
export const handler = async (event: { sku: string; counted: number }) => {
  await eventBridge.send(new PutEventsCommand({ Entries: [{ EventBusName: 'stock-events', Source: 'stock', DetailType: 'StockCounted', Detail: JSON.stringify(event) }] }));
};
