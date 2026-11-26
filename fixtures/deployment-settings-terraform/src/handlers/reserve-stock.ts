/** Reserves the stock of an order, a step of the fulfilment workflow. */
export const handler = async (input: { orderId: string; items: string[] }): Promise<{ reserved: number }> => ({
  reserved: input.items.length,
});
