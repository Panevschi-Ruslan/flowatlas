import type { Node as TsNode, PropertyDeclaration, PropertySignature } from 'ts-morph';
import type { TypeField } from '../model/types.js';

/** A property as it is declared, in either a class or an interface. */
export type FieldDeclaration = PropertyDeclaration | PropertySignature;

/**
 * An annotation a reader found and could not read.
 *
 * Recording that `@Transform` is present and saying nothing else leaves the
 * field compared as its declared type while the annotation says the wire
 * carries whatever a function returns. The reader knows that; the collector is
 * the one holding the report, so the reader hands the row over (R140).
 */
export interface UnreadAnnotation {
  /** The annotation itself: the row is written at its line. */
  readonly at: TsNode;
  readonly reason: string;
  readonly hint: string;
  readonly symbol: string;
}

export type FieldMetaResult = Partial<Pick<TypeField, 'optional' | 'meta'>> & {
  readonly unread?: readonly UnreadAnnotation[];
};

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
): { optional?: boolean; meta?: Record<string, unknown>; unread: readonly UnreadAnnotation[] } => {
  let optional: boolean | undefined;
  let meta: Record<string, unknown> | undefined;
  const unread: UnreadAnnotation[] = [];
  for (const result of results) {
    if (result.optional === true) optional = true;
    if (result.meta !== undefined) meta = { ...meta, ...result.meta };
    if (result.unread !== undefined) unread.push(...result.unread);
  }
  return {
    ...(optional === undefined ? {} : { optional }),
    ...(meta === undefined ? {} : { meta }),
    unread,
  };
};
