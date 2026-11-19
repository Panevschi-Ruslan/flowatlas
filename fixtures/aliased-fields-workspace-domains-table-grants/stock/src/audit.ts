import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

const eventBridge = new EventBridgeClient({});

/** A stock audit, announced on the bus. */
export const handler = async (event: { sku: string }) => {
  await eventBridge.send(new PutEventsCommand({ Entries: [{ EventBusName: 'stock-events', Source: 'stock', DetailType: 'StockAudited', Detail: JSON.stringify(event) }] }));
};
