import { emit, putEntry } from '../common/emit';
import { events } from '../common/events';

export const handler = async (event: { pathParameters: { id: string }; body: string }) => {
  const { carrier } = JSON.parse(event.body) as { carrier: string };
  await emit('OrderShipped', { orderId: event.pathParameters.id, carrier });
  return { statusCode: 202, body: '' };
};

/** A placed order put on the bus again, its entry built here and handed to the helper whole. */
export const resend = async (event: { orderId: string; total: number }) => putEntry(events.OrderPlaced({ orderId: event.orderId, total: event.total }));
