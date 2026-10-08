import { callsHelper, evaluateExpression, type DbOp, type DbTableAccess } from '@flowatlas/core';
import { Node, type CallExpression } from 'ts-morph';

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
/** How far a client is followed back to the call that made it. */
const MOST_HOPS = 4;

/**
 * Whether a value is what a call to the factory returned: the call itself,
 * awaited or not, or a name or a field bound to one -
 * `const db = createClient()`, `private db = createClient()` (P39).
 */
const madeBy = (value: Node, factory: { name: string; package?: string | undefined }, hops: number): boolean => {
  if (hops > MOST_HOPS) return false;
  if (Node.isParenthesizedExpression(value) || Node.isAwaitExpression(value) || Node.isNonNullExpression(value) || Node.isAsExpression(value)) {
    return madeBy(value.getExpression(), factory, hops + 1);
  }
  if (Node.isCallExpression(value)) return callsHelper(value, factory);
  if (!Node.isIdentifier(value) && !Node.isPropertyAccessExpression(value)) return false;
  return (value.getSymbol()?.getDeclarations() ?? []).some((declaration) => {
    if (!Node.isVariableDeclaration(declaration) && !Node.isPropertyDeclaration(declaration)) return false;
    const initializer = declaration.getInitializer();
    return initializer !== undefined && madeBy(initializer, factory, hops + 1);
  });
};

/**
 * Whether a call is the one a row describes: the function itself, or a method
 * of a client its factory made.
 */
const MATCHES: Readonly<Record<'function' | 'client', (call: CallExpression, access: DbTableAccess) => boolean>> = {
  function: (call, access) => callsHelper(call, access),
  client: (call, access) => {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== access.name) return false;
    return madeBy(callee.getExpression(), { name: access.factory ?? '', package: access.package }, 0);
  },
};

export const configuredAccessOf = (
  call: CallExpression,
  described: readonly DbTableAccess[],
): ConfiguredAccess | undefined => {
  const access = described.find((candidate) => MATCHES[candidate.factory === undefined ? 'function' : 'client'](call, candidate));
  if (access === undefined) return undefined;
  const op = access.op ?? null;
  if (typeof access.table === 'string') return { access, table: access.table, op };
  const argument = call.getArguments()[access.table];
  const value = argument === undefined ? undefined : evaluateExpression(argument);
  const table = value?.resolved === true && typeof value.value === 'string' && value.value !== '' ? value.value : null;
  return { access, table, op };
};
