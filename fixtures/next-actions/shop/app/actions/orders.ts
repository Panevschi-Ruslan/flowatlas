'use server';

import { actionClient, withAudit } from '../../lib/safe-action';
import { archive, exportAll, rename } from '../../lib/orders-store';

/**
 * Four boundaries, written three ways, and every one of them a way in.
 *
 * `cancelOrder` is the spelling the framework's own documentation leads with:
 * a marked module and an exported function. The other three are what most of
 * the ecosystem actually writes — a client asked for a schema, and the call
 * that ends the chain handed the work.
 */
export async function cancelOrder(id: string): Promise<{ cancelled: boolean }> {
  await archive(id);
  return { cancelled: true };
}

/** Built by a described library, with the action written in the call. */
export const archiveOrder = actionClient
  .schema({ id: 'string' })
  .action(async ({ parsedInput }: { parsedInput: { id: string } }) => {
    await archive(parsedInput.id);
    return { archived: true };
  });

/** The named function a builder was handed, which the graph can point at. */
const renameOrderAction = async ({
  parsedInput,
}: {
  parsedInput: { id: string; name: string };
}): Promise<void> => {
  await rename(parsedInput.id, parsedInput.name);
};

export const renameOrder = actionClient.schema({ id: 'string', name: 'string' }).action(renameOrderAction);

/**
 * Built by a helper of this repository, which no description names.
 *
 * It is a boundary all the same, and the run says so in one row rather than
 * leaving the repository looking as though it had three actions.
 */
export const exportOrders = withAudit(async (): Promise<string> => exportAll());
