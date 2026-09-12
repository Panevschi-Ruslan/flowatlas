import { packageOfPath } from '@flowatlas/core';
import type { ClassDeclaration } from 'ts-morph';

/**
 * What a reader would name in the configuration to make a data layer visible.
 *
 * A hand-rolled data layer is a base class and the classes that extend it, and
 * naming the base covers all of them at once, so the answer is the outermost
 * class in the chain whose name reads as a data layer. A class standing on its
 * own answers with itself. The walk stops at the first class a package declares,
 * because a receiver backed by a package is recognised by its origin and is
 * never in question here.
 */
export interface DataLayer {
  /** The class to name in `adapters.db.localBaseClasses`. */
  base: ClassDeclaration;
  /** Every local class from the receiver's own type up to that base. */
  chain: readonly string[];
}

const MAX_DEPTH = 8;

export const dataLayerOf = (
  declaration: ClassDeclaration,
  readsAsData: (name: string) => boolean,
): DataLayer | undefined => {
  const chain: string[] = [];
  let base: ClassDeclaration | undefined;
  let current: ClassDeclaration | undefined = declaration;
  for (let depth = 0; current !== undefined && depth < MAX_DEPTH; depth += 1) {
    if (packageOfPath(current.getSourceFile().getFilePath()) !== null) break;
    const name = current.getName();
    if (name !== undefined) {
      chain.push(name);
      if (readsAsData(name)) base = current;
    }
    current = current.getBaseClass();
  }
  return base === undefined ? undefined : { base, chain };
};
