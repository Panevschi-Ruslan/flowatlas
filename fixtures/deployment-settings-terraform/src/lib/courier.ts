/** Books a courier for one order. */
export const bookCourier = async (order: { orderId: string }): Promise<string> => {
  if (order.orderId === '') throw new Error('no order');
  return `booking-${order.orderId}`;
};

/** Charges one order, failing on an empty one. */
export const chargeOrder = async (order: { orderId: string; total: number }): Promise<void> => {
  if (order.total <= 0) throw new Error(`nothing to charge for ${order.orderId}`);
};
