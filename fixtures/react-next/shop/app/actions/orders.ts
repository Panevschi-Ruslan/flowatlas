'use server';

import { archive, patchOrder } from '../../lib/orders-store';

/**
 * A boundary with no address.
 *
 * The client imports this and calls it. The bundler turns that call into a
 * request to the server, and no URL is written anywhere in this repository —
 * so the only evidence the boundary exists is the directive at the top of this
 * file, and the only evidence of who crosses it is the import.
 */
export async function archiveOrder(id: string): Promise<{ archived: boolean }> {
  await archive(id);
  return { archived: true };
}

export async function renameOrder(id: string, name: string): Promise<void> {
  await patchOrder(id, { name });
}
