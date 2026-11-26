const BUS = 'shop-events';

/**
 * Every event the shop puts on its bus, one factory each: the entry it is put
 * as, built from what the caller hands it.
 */
export const events = {
  OrderPlaced: (data: Record<string, unknown>) => ({
    EventBusName: BUS,
    Source: 'shop.orders',
    DetailType: 'OrderPlaced',
    Detail: JSON.stringify({ orderId: data.orderId, total: data.total }),
  }),
  OrderShipped: (data: Record<string, unknown>) => ({
    EventBusName: BUS,
    Source: 'shop.shipping',
    DetailType: 'OrderShipped',
    Detail: JSON.stringify({ orderId: data.orderId, carrier: data.carrier }),
  }),
  StockReserved(data: Record<string, unknown>) {
    const detail = { orderId: data.orderId, items: data.items };
    return {
      EventBusName: BUS,
      Source: 'shop.stock',
      DetailType: 'StockReserved',
      Detail: JSON.stringify(detail),
    };
  },
};

/** One event built on its own, by a function rather than a member of the record. */
export const refundIssued = (orderId: string, amount: number) => ({
  EventBusName: BUS,
  Source: 'shop.payments',
  DetailType: 'RefundIssued',
  Detail: JSON.stringify({ orderId, amount }),
});
