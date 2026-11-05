import { isNullable, namedTypeOf, typeText, type Document, type TypeDefinition } from './parse.js';

/**
 * A schema, as the graph keeps it (P232): its root types and each type's
 * fields, every type written as GraphQL writes it (`[Order!]!`), so it can sit
 * in a node's `meta` and be compared without parsing again.
 */
export interface SchemaSummary {
  readonly roots: { readonly query: string; readonly mutation?: string; readonly subscription?: string };
  readonly types: Readonly<Record<string, SchemaType>>;
}

export interface SchemaType {
  readonly kind: TypeDefinition['of'];
  readonly fields?: Readonly<Record<string, SchemaField>>;
  /** A union's members and an interface's implementations, for a selection on either. */
  readonly possible?: readonly string[];
  /** Directives on the type, by name: `key` marks a federated entity. */
  readonly directives?: readonly string[];
}

export interface SchemaField {
  readonly type: string;
  readonly args?: Readonly<Record<string, { readonly type: string; readonly required: boolean }>>;
  /** Where it is declared, when a reader knows: `file:line`. */
  readonly at?: string;
}

const ROOT_DEFAULTS = { query: 'Query', mutation: 'Mutation', subscription: 'Subscription' } as const;

/** The schema the type definitions of some documents declare together, extensions merged in. */
export const schemaOf = (documents: readonly Document[]): SchemaSummary => {
  const types: Record<string, { kind: TypeDefinition['of']; fields: Record<string, SchemaField>; possible: Set<string>; directives: Set<string> }> = {};
  const roots: { query?: string; mutation?: string; subscription?: string } = {};
  for (const document of documents) {
    for (const definition of document.definitions) {
      if (definition.kind === 'schema') Object.assign(roots, definition.roots);
      if (definition.kind !== 'type') continue;
      const type = (types[definition.name] ??= { kind: definition.of, fields: {}, possible: new Set(), directives: new Set() });
      for (const directive of definition.directives) type.directives.add(directive);
      for (const field of definition.fields) {
        const args = Object.fromEntries(field.arguments.map((arg) => [arg.name, { type: typeText(arg.type), required: !isNullable(arg.type) && !arg.hasDefault }]));
        type.fields[field.name] = { type: typeText(field.type), ...(field.arguments.length === 0 ? {} : { args }) };
      }
      for (const input of definition.inputs) type.fields[input.name] = { type: typeText(input.type) };
      for (const member of definition.members) type.possible.add(member);
    }
  }
  // An interface's implementations are the types that say they implement it.
  for (const document of documents) {
    for (const definition of document.definitions) {
      if (definition.kind !== 'type') continue;
      for (const name of definition.interfaces) types[name]?.possible.add(definition.name);
    }
  }
  const root = (operation: keyof typeof ROOT_DEFAULTS): string | undefined =>
    roots[operation] ?? (types[ROOT_DEFAULTS[operation]] === undefined ? undefined : ROOT_DEFAULTS[operation]);
  const query = root('query') ?? ROOT_DEFAULTS.query;
  const mutation = root('mutation');
  const subscription = root('subscription');
  return {
    roots: { query, ...(mutation === undefined ? {} : { mutation }), ...(subscription === undefined ? {} : { subscription }) },
    types: Object.fromEntries(
      Object.entries(types)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([name, type]) => [
          name,
          {
            kind: type.kind,
            ...(Object.keys(type.fields).length === 0 ? {} : { fields: type.fields }),
            ...(type.possible.size === 0 ? {} : { possible: [...type.possible].sort() }),
            ...(type.directives.size === 0 ? {} : { directives: [...type.directives].sort() }),
          },
        ]),
    ),
  };
};

/**
 * The fields of a type two readings declare, the second's over the first's -
 * but a field the second declares with no arguments keeps the first's: a
 * resolver whose code names no arguments does not take away the ones the SDL
 * declares.
 */
const mergeFields = (a: SchemaType['fields'], b: SchemaType['fields']): Record<string, SchemaField> => {
  const fields: Record<string, SchemaField> = { ...a, ...b };
  for (const [name, field] of Object.entries(b ?? {})) {
    const args = a?.[name]?.args;
    if (field.args === undefined && args !== undefined) fields[name] = { ...field, args };
  }
  return fields;
};

/** Two summaries as one: the second's fields added to the first's types. */
export const mergeSchemas = (a: SchemaSummary, b: SchemaSummary): SchemaSummary => {
  const types: Record<string, SchemaType> = { ...a.types };
  for (const [name, type] of Object.entries(b.types)) {
    const known = types[name];
    types[name] =
      known === undefined
        ? type
        : {
            ...known,
            fields: mergeFields(known.fields, type.fields),
            ...(known.possible === undefined && type.possible === undefined ? {} : { possible: [...new Set([...(known.possible ?? []), ...(type.possible ?? [])])].sort() }),
          };
  }
  return { roots: { ...b.roots, ...a.roots }, types };
};

/** The named type a field's type is: `[Order!]!` is `Order`. */
export const namedTypeIn = (type: string): string => type.replace(/[[\]!]/g, '');

/** The root type of an operation in a schema. */
export const rootTypeOf = (schema: SchemaSummary, operation: 'query' | 'mutation' | 'subscription'): string | undefined => schema.roots[operation];

export { namedTypeOf };
