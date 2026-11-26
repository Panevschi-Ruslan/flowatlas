import { isNullable, typeText, type Document, type FragmentDefinition, type OperationDefinition, type Selection } from './parse.js';
import { namedTypeIn, type SchemaSummary } from './schema.js';

/**
 * Where a document's text is written, as its reader names it: the file, and
 * the line of an offset into the text.
 */
export interface Written {
  readonly path: string;
  readonly lineAt: (offset: number) => number;
}

/**
 * A fragment another document defines, handed to the one that spreads it,
 * with where that document is written: its fields are at their own lines of
 * their own file, not at offsets into the operation's text.
 */
export type HandedFragment = FragmentDefinition & { readonly written?: Written };

/**
 * What an operation asks for (P232): the root fields it selects and, under
 * each, the fields selected from what that returns - fragments put in place,
 * so the tree is what reaches the server whatever was spelled as a fragment.
 */
export interface SelectedField {
  readonly field: string;
  readonly alias?: string;
  /** The arguments written, by name. */
  readonly arguments: readonly string[];
  /** The type a fragment or an inline fragment narrowed this selection to. */
  readonly on?: string;
  /** Offset into the document's text, or into the text of the fragment it came from. */
  readonly at: number;
  /** Where that fragment is written, when it came from another document. */
  readonly written?: Written;
  readonly selections: readonly SelectedField[];
}

export interface Operation {
  readonly operation: 'query' | 'mutation' | 'subscription';
  readonly name?: string;
  readonly variables: ReadonlyArray<{ readonly name: string; readonly type: string; readonly required: boolean }>;
  readonly fields: readonly SelectedField[];
  readonly at: number;
  /** Fragments spread that neither the document nor the ones handed in define. */
  readonly missingFragments: readonly string[];
}

const flatten = (
  selections: readonly Selection[],
  fragments: ReadonlyMap<string, HandedFragment>,
  missing: Set<string>,
  on: string | undefined,
  written: Written | undefined,
  depth: number,
): SelectedField[] => {
  if (depth > 32) return [];
  return selections.flatMap((selection): SelectedField[] => {
    if (selection.kind === 'field') {
      return [
        {
          field: selection.name,
          ...(selection.alias === undefined ? {} : { alias: selection.alias }),
          arguments: selection.arguments.map((arg) => arg.name),
          ...(on === undefined ? {} : { on }),
          at: selection.at,
          ...(written === undefined ? {} : { written }),
          selections: flatten(selection.selections, fragments, missing, undefined, written, depth + 1),
        },
      ];
    }
    if (selection.kind === 'inline') return flatten(selection.selections, fragments, missing, selection.on ?? on, written, depth + 1);
    const fragment = fragments.get(selection.name);
    if (fragment === undefined) {
      missing.add(selection.name);
      return [];
    }
    // A fragment of the operation's own document is written where the operation is.
    return flatten(fragment.selections, fragments, missing, fragment.on, fragment.written, depth + 1);
  });
};

/** Every operation of a document, with its own fragments and the ones handed in put in place. */
export const operationsOf = (document: Document, extra: readonly HandedFragment[] = []): Operation[] => {
  const fragments = new Map<string, HandedFragment>(extra.map((fragment) => [fragment.name, fragment]));
  for (const definition of document.definitions) if (definition.kind === 'fragment') fragments.set(definition.name, definition);
  return document.definitions
    .filter((definition): definition is OperationDefinition => definition.kind === 'operation')
    .map((definition) => {
      const missing = new Set<string>();
      const fields = flatten(definition.selections, fragments, missing, undefined, undefined, 0);
      return {
        operation: definition.operation,
        ...(definition.name === undefined ? {} : { name: definition.name }),
        variables: definition.variables.map((variable) => ({ name: variable.name, type: typeText(variable.type), required: !isNullable(variable.type) && !variable.hasDefault })),
        fields,
        at: definition.at,
        missingFragments: [...missing].sort(),
      };
    });
};

/** The fragments a document defines, for another document that spreads them. */
export const fragmentsOf = (document: Document): FragmentDefinition[] =>
  document.definitions.filter((definition): definition is FragmentDefinition => definition.kind === 'fragment');

/** One field a selection reaches, with the type it is a field of. */
export interface Reached {
  readonly type: string;
  readonly field: string;
  readonly selected: SelectedField;
  /** Dotted, from the root field: `orders.customer.name`. */
  readonly path: string;
  /** Whether the schema has the field on that type. */
  readonly known: boolean;
}

/**
 * Every field a selection reaches in a schema, the root fields first: the
 * type each is a field of, found by walking down from the root type. A field
 * the type does not have is reached and not known; what is under it is not
 * walked, since nothing says what it would be.
 */
export const reachedFields = (schema: SchemaSummary, rootType: string, fields: readonly SelectedField[]): Reached[] => {
  const found: Reached[] = [];
  const walk = (type: string, selected: readonly SelectedField[], above: string, depth: number): void => {
    if (depth > 32) return;
    for (const one of selected) {
      if (one.field === '__typename') continue;
      const owner = one.on ?? type;
      const definition = schema.types[owner]?.fields?.[one.field];
      const path = above === '' ? (one.alias ?? one.field) : `${above}.${one.alias ?? one.field}`;
      found.push({ type: owner, field: one.field, selected: one, path, known: definition !== undefined });
      if (definition !== undefined && one.selections.length > 0) walk(namedTypeIn(definition.type), one.selections, path, depth + 1);
    }
  };
  walk(rootType, fields, '', 0);
  return found;
};
