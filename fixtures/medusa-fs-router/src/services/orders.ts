/** What the route handlers of this fixture hand their work to. */
export const listOrders = async (query: string | undefined): Promise<unknown[]> => [{ query }];

export const oneOrder = async (id: string): Promise<unknown> => ({ id });
