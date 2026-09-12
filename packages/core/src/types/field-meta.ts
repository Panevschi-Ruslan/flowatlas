import type { PropertyDeclaration, PropertySignature } from 'ts-morph';
import type { TypeField } from '../model/types.js';

/** A property as it is declared, in either a class or an interface. */
export type FieldDeclaration = PropertyDeclaration | PropertySignature;

export type FieldMetaResult = Partial<Pick<TypeField, 'optional' | 'meta'>>;

/**
 * Reads what a library's annotations say about a field.
 *
 * The shape a type has in the source and the shape it has on the wire are not
 * always the same: a field may be renamed, dropped, or made optional by an
 * annotation the type system knows nothing about. The core cannot know which
 * libraries do that, so whoever does supplies a reader.
 */
export interface FieldMetaReader {
  readonly name: string;
  read(property: FieldDeclaration): FieldMetaResult;
}

/** Merges what several readers said about one field. */
export const mergeFieldMeta = (
  results: readonly FieldMetaResult[],
): { optional?: boolean; meta?: Record<string, unknown> } => {
  let optional: boolean | undefined;
  let meta: Record<string, unknown> | undefined;
  for (const result of results) {
    if (result.optional === true) optional = true;
    if (result.meta !== undefined) meta = { ...meta, ...result.meta };
  }
  return {
    ...(optional === undefined ? {} : { optional }),
    ...(meta === undefined ? {} : { meta }),
  };
};
