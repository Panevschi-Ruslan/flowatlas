import { argumentOf, isNullable, namedTypeOf, stringsOf, typeText, type AppliedDirective, type Document, type InputValue, type TypeDefinition, type Value } from './parse.js';

/**
 * A schema, as the graph keeps it (P232): its root types and each type's
 * fields, every type written as GraphQL writes it (`[Order!]!`), so it can sit
 * in a node's `meta` and be compared without parsing again.
 */
export interface SchemaSummary {
  readonly roots: { readonly query: string; readonly mutation?: string; readonly subscription?: string };
  readonly types: Readonly<Record<string, SchemaType>>;
  /** The federation version the schema is a subgraph of, when it is one (P241). */
  readonly federation?: 1 | 2;
  /**
   * The directives of its own a subgraph asks composition to keep in the
   * supergraph (`@composeDirective(name: "@audited")`), with the
   * specification it links them from and whether it defines them (P245).
   */
  readonly composeDirectives?: readonly ComposedDirective[];
}

/** A directive a subgraph composes into the supergraph (P245). */
export interface ComposedDirective {
  /** Its name, without the `@`. */
  readonly name: string;
  /** The specification `@link(url:)` imports it from, where one does. */
  readonly url?: string;
  /** Whether the schema defines it (`directive @audited … on …`) or imports it from a linked specification. */
  readonly defined: boolean;
}

/**
 * One of the router's authorization directives (P245): `@authenticated`, or
 * `@requiresScopes(scopes:)` / `@policy(policies:)`, whose argument is a list
 * of alternatives, each a list of names all of which are needed -
 * `[["read:orders", "staff"], ["admin"]]` is both of the first two, or the
 * third.
 */
export type AuthRequirement =
  | { readonly kind: 'authenticated' }
  | { readonly kind: 'scopes' | 'policy'; readonly any: ReadonlyArray<readonly string[]> };

/** A requirement as a check is named: `@authenticated`, `@requiresScopes(read:orders & staff | admin)`. */
export const authLabel = (requirement: AuthRequirement): string =>
  requirement.kind === 'authenticated'
    ? '@authenticated'
    : `@${requirement.kind === 'scopes' ? 'requiresScopes' : 'policy'}(${requirement.any.map((all) => all.join(' & ')).join(' | ')})`;

/** Requirements together, each once, in the order first met. */
export const mergeAuth = (...lists: ReadonlyArray<readonly AuthRequirement[] | undefined>): AuthRequirement[] => {
  const found = new Map<string, AuthRequirement>();
  for (const list of lists) for (const requirement of list ?? []) if (!found.has(authLabel(requirement))) found.set(authLabel(requirement), requirement);
  return [...found.values()];
};

/** How many sets the requirements held together are written out as before implication is decided by spelling alone. */
const MOST_HELD_SETS = 256;

/**
 * Whether a request every one of `held` lets through is let through by
 * `asked` too (P261): the router's own reading of the lists, the outer one
 * any of, the inner one all of. The requirements held together are met by
 * the sets of names one alternative of each makes up; `asked` holds where
 * each such set includes one of its alternatives. A scope is only ever on a
 * token, so scopes asked of every request (no alternative empty) imply
 * `@authenticated`; a policy is decided by whatever evaluates it, which may
 * let an anonymous request through, so it does not. Where the sets are too
 * many to write out, only the same requirement written again implies it.
 */
export const impliesAuth = (held: readonly AuthRequirement[], asked: AuthRequirement): boolean => {
  if (held.some((one) => authLabel(one) === authLabel(asked))) return true;
  if (asked.kind === 'authenticated') return held.some((one) => one.kind === 'authenticated' || (one.kind === 'scopes' && one.any.every((all) => all.length > 0)));
  let sets: ReadonlySet<string>[] = [new Set()];
  for (const one of held) {
    if (one.kind !== asked.kind) continue;
    const next: ReadonlySet<string>[] = [];
    for (const set of sets) for (const all of one.any) next.push(new Set([...set, ...all]));
    if (next.length > MOST_HELD_SETS) return false;
    sets = next;
  }
  return sets.every((set) => asked.any.some((all) => all.every((name) => set.has(name))));
};

/** `[["a", "b"], ["c"]]`; a single list or a name is coerced the way GraphQL coerces input, each item an alternative. */
const alternativesOf = (value: Value | undefined): string[][] => {
  if (value === undefined) return [];
  if (value.kind === 'string') return [[value.value]];
  if (value.kind !== 'list') return [];
  return value.items.map((item) => stringsOf(item)).filter((all) => all.length > 0);
};

/** The requirement one directive writes, by its canonical name, or nothing. */
export const authOf = (name: string, directive: AppliedDirective): AuthRequirement | undefined => {
  if (name === 'authenticated') return { kind: 'authenticated' };
  if (name === 'requiresScopes') return { kind: 'scopes', any: alternativesOf(argumentOf(directive, 'scopes')) };
  if (name === 'policy') return { kind: 'policy', any: alternativesOf(argumentOf(directive, 'policies')) };
  return undefined;
};

/** A selection written in braces as the fields inside them: `{ currency { id } }` is `currency { id }`. */
export const selectionText = (written: string): string => {
  const trimmed = written.trim();
  return trimmed.startsWith('{') && trimmed.endsWith('}') ? trimmed.slice(1, -1).trim() : trimmed;
};

/** What `@fromContext(field:)` asks for: `$userContext { currency }` is the context `userContext` and `currency`. */
export const contextFieldOf = (written: string): { context: string; selection: string } | undefined => {
  const match = /^\s*\$([_A-Za-z][_0-9A-Za-z]*)\s*([\s\S]*)$/.exec(written);
  if (match === null) return undefined;
  return { context: match[1] as string, selection: selectionText(match[2] as string) };
};

export interface SchemaType {
  readonly kind: TypeDefinition['of'];
  readonly fields?: Readonly<Record<string, SchemaField>>;
  /** A union's members and an interface's implementations, for a selection on either. */
  readonly possible?: readonly string[];
  /** Directives on the type, by name: `key` marks a federated entity. */
  readonly directives?: readonly string[];
  /** What a subgraph says of the type: its keys, and whether it is shared or hidden (P241). */
  readonly federation?: TypeFederation;
}

export interface SchemaField {
  readonly type: string;
  readonly args?: Readonly<Record<string, { readonly type: string; readonly required: boolean }>>;
  /** Where it is declared, when a reader knows: `file:line`. */
  readonly at?: string;
  /** What a subgraph says of the field: who resolves it, and what it needs (P241). */
  readonly federation?: FieldFederation;
}

/**
 * A federated type, as one subgraph declares it: the keys it can be fetched
 * by (`@key(fields: "id")`, `resolvable: false` for a stub that only names
 * one), whether it extends a type another subgraph owns (federation 1's
 * `extend type`, `@extends`), and the type-wide `@shareable` and
 * `@inaccessible`.
 */
export interface TypeFederation {
  readonly keys?: ReadonlyArray<{ readonly fields: string; readonly resolvable?: false }>;
  readonly extension?: true;
  readonly shareable?: true;
  readonly inaccessible?: true;
  /** `@interfaceObject`: an interface another subgraph owns, to which this one adds fields as if it were an object (P245). */
  readonly interfaceObject?: true;
  /** `@context(name:)`: the contexts it sets for the fields below it (P245). */
  readonly contexts?: readonly string[];
  /** The router's authorization directives written on it (P245). */
  readonly auth?: readonly AuthRequirement[];
  /** The directives it carries that the subgraph composes (`@composeDirective`), by name (P245). */
  readonly directives?: readonly string[];
}

/**
 * A federated field, as one subgraph declares it: `@external` (another
 * subgraph resolves it), `@requires` and `@provides` with their field sets,
 * `@shareable`, `@override(from:, label:)` and `@inaccessible`.
 */
export interface FieldFederation {
  readonly external?: true;
  readonly requires?: string;
  readonly provides?: string;
  readonly shareable?: true;
  readonly override?: { readonly from: string; readonly label?: string };
  readonly inaccessible?: true;
  /** The router's authorization directives written on it (P245). */
  readonly auth?: readonly AuthRequirement[];
  /** Arguments the router fills from an ancestor (`@fromContext(field: "$ctx { … }")`), by argument (P245). */
  readonly fromContext?: Readonly<Record<string, { readonly context: string; readonly selection: string }>>;
  /** The directives it carries that the subgraph composes, by name (P245). */
  readonly directives?: readonly string[];
}

/** The directives federation defines, by the name its specification gives them. */
const FEDERATION_DIRECTIVES = new Set([
  'key',
  'external',
  'requires',
  'provides',
  'shareable',
  'override',
  'inaccessible',
  'extends',
  'interfaceObject',
  'tag',
  'composeDirective',
  'context',
  'fromContext',
  'authenticated',
  'requiresScopes',
  'policy',
]);

/** Whether a URL is federation 2's specification, linked by `extend schema @link(url: …)`. */
const FEDERATION_SPEC = /specs\.apollo\.dev\/federation\/v2/;

/**
 * What each directive a schema writes is called by federation: a name
 * imported under another (`{ name: "@key", as: "@primaryKey" }`) is the one
 * imported, and one left in the specification's namespace (`@federation__key`,
 * or under the prefix the link gives it) is the one it names. A schema that
 * links nothing is federation 1, where the names are the plain ones.
 */
export const federationNamesOf = (
  documents: readonly Document[],
): { version?: 1 | 2; canonical: (name: string) => string; composed: ReadonlySet<string>; composeDirectives: ComposedDirective[] } => {
  const renamed = new Map<string, string>();
  const prefixes = new Set<string>();
  /** What every other specification a schema links imports, by the name it is used under: a composed directive's URL (P245). */
  const linkedFrom = new Map<string, string>();
  const asked: AppliedDirective[] = [];
  const defined = new Set<string>();
  let linked = false;
  for (const document of documents) {
    for (const definition of document.definitions) {
      if (definition.kind === 'directive') defined.add(definition.name);
      if (definition.kind !== 'schema') continue;
      for (const link of definition.directives) {
        if (link.name !== 'link') {
          asked.push(link);
          continue;
        }
        const url = stringsOf(argumentOf(link, 'url'))[0] ?? '';
        if (!FEDERATION_SPEC.test(url)) {
          const imports = argumentOf(link, 'import');
          for (const item of imports?.kind === 'list' ? imports.items : []) {
            const name = item.kind === 'string' ? item.value : item.kind === 'object' ? stringsOf(item.fields['as'] ?? item.fields['name'])[0] : undefined;
            if (name !== undefined) linkedFrom.set(name.replace(/^@/, ''), url);
          }
          continue;
        }
        linked = true;
        prefixes.add(stringsOf(argumentOf(link, 'as'))[0] ?? 'federation');
        const imports = argumentOf(link, 'import');
        for (const item of imports?.kind === 'list' ? imports.items : []) {
          if (item.kind === 'string') renamed.set(item.value.replace(/^@/, ''), item.value.replace(/^@/, ''));
          if (item.kind === 'object') {
            const name = stringsOf(item.fields['name'])[0]?.replace(/^@/, '');
            const as = stringsOf(item.fields['as'])[0]?.replace(/^@/, '');
            if (name !== undefined) renamed.set(as ?? name, name);
          }
        }
      }
    }
  }
  const canonical = (name: string): string => {
    const imported = renamed.get(name);
    if (imported !== undefined) return imported;
    for (const prefix of prefixes) if (name.startsWith(`${prefix}__`)) return name.slice(prefix.length + 2);
    return name;
  };
  // `@composeDirective(name: "@audited")`, under whatever name it is imported as (P245).
  const names = asked.filter((directive) => canonical(directive.name) === 'composeDirective').flatMap((directive) => stringsOf(argumentOf(directive, 'name')).map((name) => name.replace(/^@/, '')));
  const composeDirectives = [...new Set(names)].map((name): ComposedDirective => {
    const url = linkedFrom.get(name);
    return { name, ...(url === undefined ? {} : { url }), defined: defined.has(name) || url !== undefined };
  });
  const composed = new Set(composeDirectives.map((directive) => directive.name));
  if (linked) return { version: 2, canonical, composed, composeDirectives };
  const federated = documents.some((document) =>
    document.definitions.some(
      (definition) =>
        definition.kind === 'type' &&
        (definition.applied.some((directive) => FEDERATION_DIRECTIVES.has(directive.name)) || definition.fields.some((field) => field.directives.some((directive) => FEDERATION_DIRECTIVES.has(directive.name)))),
    ),
  );
  return { ...(federated ? { version: 1 as const } : {}), canonical, composed, composeDirectives };
};

/** What a type's own directives say of it under federation, or nothing. */
export const typeFederationOf = (
  applied: readonly AppliedDirective[],
  extend: boolean,
  canonical: (name: string) => string,
  composed: ReadonlySet<string> = new Set(),
): TypeFederation | undefined => {
  const keys: Array<{ fields: string; resolvable?: false }> = [];
  let extension = false;
  let shareable = false;
  let inaccessible = false;
  let interfaceObject = false;
  const contexts: string[] = [];
  const auth: AuthRequirement[] = [];
  const directives: string[] = [];
  for (const directive of applied) {
    const name = canonical(directive.name);
    if (composed.has(directive.name) && !directives.includes(directive.name)) directives.push(directive.name);
    if (name === 'interfaceObject') interfaceObject = true;
    if (name === 'context') contexts.push(...stringsOf(argumentOf(directive, 'name')));
    const requirement = authOf(name, directive);
    if (requirement !== undefined) auth.push(requirement);
    if (name === 'key') {
      const fields = stringsOf(argumentOf(directive, 'fields'))[0];
      const resolvable = argumentOf(directive, 'resolvable');
      if (fields !== undefined) keys.push({ fields, ...(resolvable?.kind === 'literal' && resolvable.text === 'false' ? { resolvable: false as const } : {}) });
    }
    if (name === 'extends') extension = true;
    if (name === 'shareable') shareable = true;
    if (name === 'inaccessible') inaccessible = true;
  }
  if (keys.length > 0 && extend) extension = true;
  if (keys.length === 0 && !extension && !shareable && !inaccessible && !interfaceObject && contexts.length === 0 && auth.length === 0 && directives.length === 0) return undefined;
  return {
    ...(keys.length === 0 ? {} : { keys }),
    ...(extension ? { extension: true as const } : {}),
    ...(shareable ? { shareable: true as const } : {}),
    ...(inaccessible ? { inaccessible: true as const } : {}),
    ...(interfaceObject ? { interfaceObject: true as const } : {}),
    ...(contexts.length === 0 ? {} : { contexts }),
    ...(auth.length === 0 ? {} : { auth: mergeAuth(auth) }),
    ...(directives.length === 0 ? {} : { directives }),
  };
};

/** What a field's own directives say of it under federation, or nothing. */
export const fieldFederationOf = (
  applied: readonly AppliedDirective[],
  canonical: (name: string) => string,
  composed: ReadonlySet<string> = new Set(),
  args: readonly InputValue[] = [],
): FieldFederation | undefined => {
  const found: { -readonly [K in keyof FieldFederation]: FieldFederation[K] } = {};
  const auth: AuthRequirement[] = [];
  const directives: string[] = [];
  // An argument the router fills from an ancestor's fields, not one a client passes (P245).
  const fromContext: Record<string, { context: string; selection: string }> = {};
  for (const arg of args) {
    for (const directive of arg.directives) {
      if (canonical(directive.name) !== 'fromContext') continue;
      const field = contextFieldOf(stringsOf(argumentOf(directive, 'field'))[0] ?? '');
      if (field !== undefined) fromContext[arg.name] = field;
    }
  }
  if (Object.keys(fromContext).length > 0) found.fromContext = fromContext;
  for (const directive of applied) {
    const name = canonical(directive.name);
    if (composed.has(directive.name) && !directives.includes(directive.name)) directives.push(directive.name);
    const requirement = authOf(name, directive);
    if (requirement !== undefined) auth.push(requirement);
    if (name === 'external') found.external = true;
    if (name === 'shareable') found.shareable = true;
    if (name === 'inaccessible') found.inaccessible = true;
    if (name === 'requires' || name === 'provides') {
      const fields = stringsOf(argumentOf(directive, 'fields'))[0];
      if (fields !== undefined) found[name] = fields;
    }
    if (name === 'override') {
      const from = stringsOf(argumentOf(directive, 'from'))[0];
      const label = stringsOf(argumentOf(directive, 'label'))[0];
      if (from !== undefined) found.override = { from, ...(label === undefined ? {} : { label }) };
    }
  }
  if (auth.length > 0) found.auth = mergeAuth(auth);
  if (directives.length > 0) found.directives = directives;
  return Object.keys(found).length === 0 ? undefined : found;
};

/** Two readings of one type's federation as one: keys added, flags kept. */
const mergeTypeFederation = (a: TypeFederation | undefined, b: TypeFederation | undefined): TypeFederation | undefined => {
  if (a === undefined || b === undefined) return a ?? b;
  const keys = [...(a.keys ?? []), ...(b.keys ?? [])].filter((key, index, all) => all.findIndex((other) => other.fields === key.fields) === index);
  const auth = mergeAuth(a.auth, b.auth);
  const contexts = [...new Set([...(a.contexts ?? []), ...(b.contexts ?? [])])];
  const directives = [...new Set([...(a.directives ?? []), ...(b.directives ?? [])])];
  return {
    ...a,
    ...b,
    ...(keys.length === 0 ? {} : { keys }),
    ...(auth.length === 0 ? {} : { auth }),
    ...(contexts.length === 0 ? {} : { contexts }),
    ...(directives.length === 0 ? {} : { directives }),
  };
};

const ROOT_DEFAULTS = { query: 'Query', mutation: 'Mutation', subscription: 'Subscription' } as const;

/** The schema the type definitions of some documents declare together, extensions merged in. */
export const schemaOf = (documents: readonly Document[]): SchemaSummary => {
  const types: Record<string, { kind: TypeDefinition['of']; fields: Record<string, SchemaField>; possible: Set<string>; directives: Set<string>; federation?: TypeFederation }> = {};
  const roots: { query?: string; mutation?: string; subscription?: string } = {};
  const names = federationNamesOf(documents);
  for (const document of documents) {
    for (const definition of document.definitions) {
      if (definition.kind === 'schema') Object.assign(roots, definition.roots);
      if (definition.kind !== 'type') continue;
      const type = (types[definition.name] ??= { kind: definition.of, fields: {}, possible: new Set(), directives: new Set() });
      for (const directive of definition.directives) type.directives.add(names.canonical(directive));
      const typeFederation = names.version === undefined ? undefined : typeFederationOf(definition.applied, definition.extend, names.canonical, names.composed);
      const merged = mergeTypeFederation(type.federation, typeFederation);
      if (merged !== undefined) type.federation = merged;
      for (const field of definition.fields) {
        const args = Object.fromEntries(field.arguments.map((arg) => [arg.name, { type: typeText(arg.type), required: !isNullable(arg.type) && !arg.hasDefault }]));
        const federation = names.version === undefined ? undefined : fieldFederationOf(field.directives, names.canonical, names.composed, field.arguments);
        type.fields[field.name] = { type: typeText(field.type), ...(field.arguments.length === 0 ? {} : { args }), ...(federation === undefined ? {} : { federation }) };
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
    ...(names.version === undefined ? {} : { federation: names.version }),
    ...(names.composeDirectives.length === 0 ? {} : { composeDirectives: names.composeDirectives }),
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
            ...(type.federation === undefined ? {} : { federation: type.federation }),
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
    const federation = a?.[name]?.federation;
    // Nor do they take away what a subgraph's SDL says of the field (P241).
    fields[name] = { ...field, ...(field.args === undefined && args !== undefined ? { args } : {}), ...(field.federation === undefined && federation !== undefined ? { federation } : {}) };
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
            ...(known.federation === undefined && type.federation === undefined ? {} : { federation: mergeTypeFederation(known.federation, type.federation) as TypeFederation }),
          };
  }
  const federation = a.federation === undefined || b.federation === undefined ? (a.federation ?? b.federation) : Math.max(a.federation, b.federation);
  const composeDirectives = [...(a.composeDirectives ?? []), ...(b.composeDirectives ?? []).filter((directive) => !(a.composeDirectives ?? []).some((known) => known.name === directive.name))];
  return {
    roots: { ...b.roots, ...a.roots },
    types,
    ...(federation === undefined ? {} : { federation: federation as 1 | 2 }),
    ...(composeDirectives.length === 0 ? {} : { composeDirectives }),
  };
};

/** The named type a field's type is: `[Order!]!` is `Order`. */
export const namedTypeIn = (type: string): string => type.replace(/[[\]!]/g, '');

/** The root type of an operation in a schema. */
export const rootTypeOf = (schema: SchemaSummary, operation: 'query' | 'mutation' | 'subscription'): string | undefined => schema.roots[operation];

export { namedTypeOf };
