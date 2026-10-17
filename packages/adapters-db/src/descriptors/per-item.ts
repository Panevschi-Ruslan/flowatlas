import { declarationOf, type DbDescriptor, type DbFilterAt, type DbOp } from '@flowatlas/core';
import { Node, type CallExpression } from 'ts-morph';
import { sqlIsBatch, sqlIsConditional } from '../sql.js';

/**
 * Whether one query is a batch, or a write meant to run per item (P89).
 *
 * Both are facts of the operation, read where the call is and written on its
 * node, so the pass that judges a loop asks the node and knows no library
 * (I1): a loop around nothing but batches is the chunking around a batch API,
 * and a loop around nothing but compare-and-set writes is per item on purpose.
 */
export interface PerItemMeta {
  /** The operation takes many items in one round trip. */
  batch?: true;
  /** A write whose filter names a state besides the row's id: it has no batch form. */
  conditional?: true;
}

/** The keys that pick a row by itself, and say nothing of the state it is in. */
const ID_KEYS: ReadonlySet<string> = new Set(['id', '_id', 'uuid', 'key', 'pk']);

/** Whether a method is one of the names given, exactly or by a prefix ending in `*`. */
const namedIn = (names: readonly string[] | undefined, method: string): boolean =>
  names !== undefined &&
  names.some((name) => (name.endsWith('*') ? method.startsWith(name.slice(0, -1)) : name === method));

const unwrap = (node: Node): Node => {
  let current = node;
  while (Node.isParenthesizedExpression(current) || Node.isAsExpression(current) || Node.isSatisfiesExpression(current)) {
    current = current.getExpression();
  }
  return current;
};

/** An object written out, or a `const` bound to one. */
const objectAt = (node: Node | undefined): Node | undefined => {
  if (node === undefined) return undefined;
  const inner = unwrap(node);
  if (Node.isObjectLiteralExpression(inner)) return inner;
  if (!Node.isIdentifier(inner)) return undefined;
  const declaration = declarationOf(inner);
  return declaration !== undefined && Node.isVariableDeclaration(declaration)
    ? objectAt(declaration.getInitializer())
    : undefined;
};

/** The object a path names inside an argument: `{ where: { … } }` at `['where']`. */
const filterOf = (call: CallExpression, at: DbFilterAt): Node | undefined => {
  let node = objectAt(call.getArguments()[at.argument]);
  for (const key of at.path) {
    if (node === undefined || !Node.isObjectLiteralExpression(node)) return undefined;
    const property = node.getProperty(key);
    node = property !== undefined && Node.isPropertyAssignment(property) ? objectAt(property.getInitializer()) : undefined;
  }
  return node;
};

/** Whether a filter written out tests a key besides the row's id: `{ _id, status: 'open' }`. */
const namesAState = (filter: Node | undefined): boolean => {
  if (filter === undefined || !Node.isObjectLiteralExpression(filter)) return false;
  return filter
    .getProperties()
    .some(
      (property) =>
        (Node.isPropertyAssignment(property) || Node.isShorthandPropertyAssignment(property)) &&
        !ID_KEYS.has(property.getName().replace(/^['"]|['"]$/g, '')),
    );
};

/**
 * What a query's node says about running it per item: a batch by its method
 * or its statement, a conditional write by its filter or its statement.
 * `sql` is the whole statement when the call's text was read, `op` what the
 * classification settled.
 */
export const perItemMetaOf = (
  descriptor: DbDescriptor | undefined,
  method: string,
  call: CallExpression,
  op: DbOp | null,
  sql?: string | null,
): PerItemMeta => {
  const text = sql ?? undefined;
  const batch = namedIn(descriptor?.batch, method) || (text !== undefined && sqlIsBatch(text));
  const at = descriptor?.filters !== undefined && Object.hasOwn(descriptor.filters, method) ? descriptor.filters[method] : undefined;
  const conditional =
    op === 'write' && ((at !== undefined && namesAState(filterOf(call, at))) || (text !== undefined && sqlIsConditional(text)));
  return { ...(batch ? { batch: true } : {}), ...(conditional ? { conditional: true } : {}) };
};
