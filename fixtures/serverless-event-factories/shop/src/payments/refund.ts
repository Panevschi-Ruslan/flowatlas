import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { refundIssued } from '../common/events';

const bus = new EventBridgeClient({});

export const handler = async (event: { body: string }) => {
  const { orderId, amount } = JSON.parse(event.body) as { orderId: string; amount: number };
  await bus.send(new PutEventsCommand({ Entries: [refundIssued(orderId, amount)] }));
  return { statusCode: 202, body: '' };
};
