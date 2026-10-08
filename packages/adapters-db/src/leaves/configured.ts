import { callsHelper, evaluateExpression, type DbOp, type DbTableAccess } from '@flowatlas/core';
import type { CallExpression } from 'ts-morph';

/** A call to a function the configuration names, and the table it touches. */
export interface ConfiguredAccess {
  access: DbTableAccess;
  /** The table, or null where the argument that names it is not a string this can read. */
  table: string | null;
  op: DbOp | null;
}

/**
 * The table a call touches, when the call is to a function the project named
 * under `adapters.db.tables` (P37).
 *
 * A data access behind a package of the project's own that nobody installed
 * has no type to resolve and no descriptor to describe it, but the call site
 * says everything: which function it is, by the import in the calling file,
 * and which table, by the string written at the argument the configuration
 * names. The first description that matches wins.
 */
export const configuredAccessOf = (
  call: CallExpression,
  described: readonly DbTableAccess[],
): ConfiguredAccess | undefined => {
  const access = described.find((candidate) => callsHelper(call, candidate));
  if (access === undefined) return undefined;
  const op = access.op ?? null;
  if (typeof access.table === 'string') return { access, table: access.table, op };
  const argument = call.getArguments()[access.table];
  const value = argument === undefined ? undefined : evaluateExpression(argument);
  const table = value?.resolved === true && typeof value.value === 'string' && value.value !== '' ? value.value : null;
  return { access, table, op };
};
