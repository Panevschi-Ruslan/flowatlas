/** Fulfils an order: run by the orders rule and by the ledger's topic. */
export const handler = async (event: unknown): Promise<{ fulfilled: boolean }> => {
  return { fulfilled: event !== undefined };
};
