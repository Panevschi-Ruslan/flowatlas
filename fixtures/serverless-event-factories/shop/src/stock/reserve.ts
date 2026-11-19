import { emit } from '../common/emit';

const LEDGER = process.env.LEDGER_URL;

export const handler = async (event: { detail: { orderId: string; items: string[] } }) => {
  await fetch(LEDGER, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ orderId: event.detail.orderId, items: event.detail.items }),
  });
  await emit('StockReserved', { orderId: event.detail.orderId, items: event.detail.items });
};
