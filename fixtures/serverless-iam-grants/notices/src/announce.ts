import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

const events = new EventBridgeClient({});

const buses = new Map<string, string>();

/** An order placed, onto the bus registered for its market when the container started. */
export const handler = async (event: { market: string; order: { id: string } }) => {
  await events.send(
    new PutEventsCommand({
      Entries: [{ EventBusName: buses.get(event.market), Source: 'shop.orders', DetailType: 'OrderPlaced', Detail: JSON.stringify(event.order) }],
    }),
  );
};

export const register = (market: string, bus: string): void => {
  buses.set(market, bus);
};
