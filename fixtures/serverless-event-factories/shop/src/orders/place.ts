import { emit } from '../common/emit';

export const handler = async (event: { body: string }) => {
  const order = JSON.parse(event.body) as { id: string; total: number };
  await emit('OrderPlaced', { orderId: order.id, total: order.total });
  return { statusCode: 201, body: JSON.stringify({ id: order.id }) };
};
