import { argumentOf, parseDocument, stringsOf, tryParse, type AppliedDirective, type Document, type Selection, type Value } from './parse.js';
import { schemaOf, type SchemaField, type SchemaSummary, type SchemaType } from './schema.js';

/**
 * A federated graph, composed (P241): for every field of every type, the
 * subgraphs that resolve it, and for every entity the keys each subgraph can
 * fetch it by.
 *
 * Two ways to arrive at one. A supergraph file is a composition already
 * written down - `@join__type` says which subgraphs know a type and by which
 * key, `@join__field` which of them resolves a field - and the router runs
 * exactly what it says, so it is read as it is (`supergraphComposition`).
 * Without one, a gateway composes at start from what each subgraph answers,
 * which is what its source declares, so the same is done here from the
 * subgraphs' schemas (`composeSubgraphs`), with the rules of composition and
 * the conflicts it would refuse.
 *
 * Plain data, so it can travel on a gateway's endpoint in `meta`.
 */

/** One subgraph that resolves a field, and what it says it needs or gives. */
export interface FieldOwner {
  readonly subgraph: string;
  /** `@requires(fields:)`: fields of the entity fetched from their owners first. */
  readonly requires?: string;
  /** `@provides(fields:)`: fields of what it returns that it resolves too. */
  readonly provides?: string;
  /** A progressive `@override(label:)`: the field is moved here for a share of requests only. */
  readonly label?: string;
}

export interface ComposedField {
  readonly type: string;
  readonly args?: SchemaField['args'];
  readonly owners: readonly FieldOwner[];
  /** Hidden from the API the router serves (`@inaccessible`). */
  readonly inaccessible?: true;
  /** Its line in the supergraph it was read from, where it was read from one. */
  readonly line?: number;
}

export interface ComposedType {
  readonly kind: SchemaType['kind'];
  readonly fields: Readonly<Record<string, ComposedField>>;
  /** The key field sets each subgraph can fetch the entity by: `{ customers: ['id'] }`. */
  readonly keys?: Readonly<Record<string, readonly string[]>>;
  /** The keys of subgraphs that only name the entity (`resolvable: false`). */
  readonly stubs?: Readonly<Record<string, readonly string[]>>;
  readonly possible?: readonly string[];
  readonly inaccessible?: true;
}

export interface Composition {
  readonly roots: SchemaSummary['roots'];
  readonly subgraphs: readonly string[];
  readonly types: Readonly<Record<string, ComposedType>>;
}

/**
 * A field composition would refuse: owned by several subgraphs that do not
 * all share it (`shared`), or owned by a subgraph an entity call cannot
 * reach, since it declares no key the entity can be fetched by while other
 * subgraphs hand the entity out (`unreachable`).
 */
export interface CompositionConflict {
  readonly kind: 'shared' | 'unreachable';
  readonly type: string;
  readonly field: string;
  readonly subgraphs: readonly string[];
}

/** One subgraph's schema, as its endpoint carries it. */
export interface SubgraphSchema {
  readonly name: string;
  readonly schema: SchemaSummary;
}

const ROOT_NAMES = { query: 'Query', mutation: 'Mutation', subscription: 'Subscription' } as const;

/**
 * Types federation adds to a subgraph or a supergraph for its own use, never
 * part of the graph a client asks: `_Service`, `_Entity`, `_Any`, and
 * anything in a specification's namespace (`join__Graph`, `link__Import`).
 */
const isMachinery = (name: string): boolean => name.startsWith('_') || name.includes('__') || name === 'FieldSet';

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The top-level field names of a field set: `"id"`, `"id sku"`, `"organization { id }"`. */
export const fieldSetNames = (fields: string): string[] => {
  const document = tryParse(`{ ${fields} }`);
  const [operation] = document?.definitions ?? [];
  if (operation?.kind !== 'operation') return [];
  return operation.selections.flatMap((selection) => (selection.kind === 'field' ? [selection.name] : []));
};

/** A field set as selections, for planning what `@requires` needs. */
export const fieldSetSelections = (fields: string): readonly Selection[] => {
  try {
    const [operation] = parseDocument(`{ ${fields} }`).definitions;
    return operation?.kind === 'operation' ? operation.selections : [];
  } catch {
    return [];
  }
};

/** A builder of one composed type, filled subgraph by subgraph. */
interface Building {
  kind: SchemaType['kind'];
  fields: Map<string, { type: string; args?: SchemaField['args']; owners: Array<FieldOwner & { shared: boolean; override?: { from: string; label?: string } }>; inaccessible: boolean; line?: number }>;
  keys: Map<string, string[]>;
  stubs: Map<string, string[]>;
  possible: Set<string>;
  inaccessible: boolean;
}

const building = (kind: SchemaType['kind']): Building => ({ kind, fields: new Map(), keys: new Map(), stubs: new Map(), possible: new Set(), inaccessible: false });

const finish = (roots: SchemaSummary['roots'], subgraphs: readonly string[], types: ReadonlyMap<string, Building>): Composition => ({
  roots,
  subgraphs: [...subgraphs].sort(cmp),
  types: Object.fromEntries(
    [...types.entries()]
      .sort(([a], [b]) => cmp(a, b))
      .map(([name, type]): [string, ComposedType] => [
        name,
        {
          kind: type.kind,
          fields: Object.fromEntries(
            [...type.fields.entries()].map(([field, made]): [string, ComposedField] => [
              field,
              {
                type: made.type,
                ...(made.args === undefined ? {} : { args: made.args }),
                owners: made.owners
                  .map(({ shared: _shared, override: _override, ...owner }) => owner)
                  .sort((a, b) => cmp(a.subgraph, b.subgraph)),
                ...(made.inaccessible ? { inaccessible: true as const } : {}),
                ...(made.line === undefined ? {} : { line: made.line }),
              },
            ]),
          ),
          ...(type.keys.size === 0 ? {} : { keys: Object.fromEntries([...type.keys.entries()].sort(([a], [b]) => cmp(a, b))) }),
          ...(type.stubs.size === 0 ? {} : { stubs: Object.fromEntries([...type.stubs.entries()].sort(([a], [b]) => cmp(a, b))) }),
          ...(type.possible.size === 0 ? {} : { possible: [...type.possible].sort(cmp) }),
          ...(type.inaccessible ? { inaccessible: true as const } : {}),
        },
      ]),
  ),
});

/**
 * The composition a gateway makes of these subgraphs at start (D3, D4).
 *
 * Every subgraph that declares a field and does not mark it `@external`
 * resolves it; `@override(from:)` takes it from the subgraph it names, and a
 * `label` leaves both, the router moving a share of requests. Two owners must
 * both share the field - `@shareable` on it or its type in federation 2, a
 * key field of an entity, a value type in federation 1 - or composition
 * fails: the field is a conflict, and still composed to both, so a plan can
 * say the choice rather than drop the field.
 */
export const composeSubgraphs = (subgraphs: readonly SubgraphSchema[]): { composition: Composition; conflicts: CompositionConflict[] } => {
  const types = new Map<string, Building>();
  const entities = new Set<string>();
  for (const { schema } of subgraphs) for (const [name, type] of Object.entries(schema.types)) if ((type.federation?.keys?.length ?? 0) > 0) entities.add(name);
  const ordered = [...subgraphs].sort((a, b) => cmp(a.name, b.name));
  for (const { name: subgraph, schema } of ordered) {
    const roots = new Map<string, string>();
    for (const [operation, type] of Object.entries(schema.roots)) if (type !== undefined) roots.set(type, ROOT_NAMES[operation as keyof typeof ROOT_NAMES]);
    for (const [written, type] of Object.entries(schema.types)) {
      if (isMachinery(written)) continue;
      const name = roots.get(written) ?? written;
      const root = roots.has(written) || Object.values(ROOT_NAMES).includes(name as never);
      const made = types.get(name) ?? building(type.kind);
      types.set(name, made);
      for (const member of type.possible ?? []) made.possible.add(member);
      if (type.federation?.inaccessible === true) made.inaccessible = true;
      const keyFields = new Set<string>();
      for (const key of type.federation?.keys ?? []) {
        const into = key.resolvable === false ? made.stubs : made.keys;
        into.set(subgraph, [...(into.get(subgraph) ?? []), key.fields]);
        for (const field of fieldSetNames(key.fields)) keyFields.add(field);
      }
      for (const [field, declared] of Object.entries(type.fields ?? {})) {
        if (root && field.startsWith('_')) continue;
        const composed = made.fields.get(field) ?? { type: declared.type, ...(declared.args === undefined ? {} : { args: declared.args }), owners: [], inaccessible: false };
        made.fields.set(field, composed);
        const federation = declared.federation;
        if (federation?.inaccessible === true) composed.inaccessible = true;
        // A key field marked external arrives in the representation; it is
        // nobody's to resolve, and the plan keeps it where it is (D4).
        if (federation?.external === true) continue;
        const version = schema.federation ?? 1;
        // Only an object's fields are resolved; an input, an enum or an
        // interface declared in two subgraphs is merged, never refused.
        const shared =
          type.kind !== 'object' ||
          keyFields.has(field) ||
          federation?.shareable === true ||
          type.federation?.shareable === true ||
          (version === 1 && !root && !entities.has(name));
        composed.owners.push({
          subgraph,
          ...(federation?.requires === undefined ? {} : { requires: federation.requires }),
          ...(federation?.provides === undefined ? {} : { provides: federation.provides }),
          shared,
          ...(federation?.override === undefined ? {} : { override: federation.override }),
        });
      }
    }
  }
  const conflicts: CompositionConflict[] = [];
  for (const [typeName, type] of types) {
    for (const [field, composed] of type.fields) {
      for (const owner of [...composed.owners]) {
        if (owner.override === undefined) continue;
        if (owner.override.label === undefined) composed.owners = composed.owners.filter((other) => other.subgraph !== owner.override?.from);
        else {
          composed.owners = composed.owners.map((other) => (other === owner ? { ...other, label: owner.override?.label as string } : other));
        }
      }
      const progressive = composed.owners.some((owner) => owner.label !== undefined);
      if (composed.owners.length > 1 && !progressive && !composed.owners.every((owner) => owner.shared)) {
        conflicts.push({ kind: 'shared', type: typeName, field, subgraphs: composed.owners.map((owner) => owner.subgraph).sort(cmp) });
      }
    }
  }
  const roots = { query: 'Query', ...(types.has('Mutation') ? { mutation: 'Mutation' } : {}), ...(types.has('Subscription') ? { subscription: 'Subscription' } : {}) };
  return { composition: finish(roots, subgraphs.map((each) => each.name), types), conflicts };
};

/** A subgraph a supergraph names: its name and the address the router sends to. */
export interface SupergraphGraph {
  readonly name: string;
  readonly url?: string;
  /** Offset of its `@join__graph` in the supergraph's text. */
  readonly at: number;
}

const graphArgument = (directive: AppliedDirective): string | undefined => {
  const value = argumentOf(directive, 'graph');
  return value?.kind === 'literal' ? value.text : undefined;
};

const isTrue = (value: Value | undefined): boolean => value?.kind === 'literal' && value.text === 'true';

/** Whether a document is a supergraph: one that declares the graphs it joins. */
export const isSupergraph = (document: Document): boolean =>
  document.definitions.some((definition) => definition.kind === 'type' && definition.name === 'join__Graph');

/**
 * The composition a supergraph writes down (D3): the subgraphs from
 * `enum join__Graph`, each type's subgraphs and keys from `@join__type` (and
 * `@join__owner` in the first version of the join specification), each
 * field's from `@join__field` - a field with none belongs to every subgraph
 * of its type - leaving out `external: true` and an overridden field no
 * longer used.
 */
export const supergraphComposition = (document: Document, text?: string): { composition: Composition; graphs: SupergraphGraph[] } => {
  const lineAt = (offset: number): number | undefined => (text === undefined ? undefined : text.slice(0, offset).split('\n').length);
  const graphs: SupergraphGraph[] = [];
  const byValue = new Map<string, string>();
  for (const definition of document.definitions) {
    if (definition.kind !== 'type' || definition.name !== 'join__Graph') continue;
    for (const value of definition.enumValues) {
      const graph = value.directives.find((directive) => directive.name === 'join__graph');
      const name = graph === undefined ? value.name.toLowerCase() : (stringsOf(argumentOf(graph, 'name'))[0] ?? value.name.toLowerCase());
      const url = graph === undefined ? undefined : stringsOf(argumentOf(graph, 'url'))[0];
      byValue.set(value.name, name);
      graphs.push({ name, ...(url === undefined || url === '' ? {} : { url }), at: value.at });
    }
  }
  const schema = schemaOf([document]);
  const types = new Map<string, Building>();
  for (const definition of document.definitions) {
    if (definition.kind !== 'type' || isMachinery(definition.name) || definition.of === 'scalar') continue;
    const made = types.get(definition.name) ?? building(definition.of);
    types.set(definition.name, made);
    for (const member of schema.types[definition.name]?.possible ?? []) made.possible.add(member);
    if (definition.directives.includes('inaccessible')) made.inaccessible = true;
    const typeGraphs: string[] = [];
    let owner: string | undefined;
    for (const directive of definition.applied) {
      const graph = graphArgument(directive);
      const name = graph === undefined ? undefined : (byValue.get(graph) ?? graph.toLowerCase());
      if (name === undefined) continue;
      if (directive.name === 'join__owner') owner = name;
      if (directive.name !== 'join__type') continue;
      if (!typeGraphs.includes(name)) typeGraphs.push(name);
      const key = stringsOf(argumentOf(directive, 'key'))[0];
      if (key === undefined) continue;
      const into = argumentOf(directive, 'resolvable')?.kind === 'literal' && (argumentOf(directive, 'resolvable') as { text: string }).text === 'false' ? made.stubs : made.keys;
      into.set(name, [...(into.get(name) ?? []), key]);
    }
    const defaults = owner === undefined ? typeGraphs : [owner];
    for (const field of definition.fields) {
      const declared = schema.types[definition.name]?.fields?.[field.name];
      const joins = field.directives.filter((directive) => directive.name === 'join__field' && graphArgument(directive) !== undefined);
      const owners: Array<FieldOwner & { shared: boolean }> = [];
      if (joins.length === 0) for (const graph of defaults) owners.push({ subgraph: graph, shared: true });
      for (const join of joins) {
        if (isTrue(argumentOf(join, 'external')) || isTrue(argumentOf(join, 'usedOverridden'))) continue;
        const graph = graphArgument(join) as string;
        const requires = stringsOf(argumentOf(join, 'requires'))[0];
        const provides = stringsOf(argumentOf(join, 'provides'))[0];
        const label = stringsOf(argumentOf(join, 'overrideLabel'))[0];
        const from = stringsOf(argumentOf(join, 'override'))[0];
        owners.push({ subgraph: byValue.get(graph) ?? graph.toLowerCase(), ...(requires === undefined ? {} : { requires }), ...(provides === undefined ? {} : { provides }), ...(label === undefined ? {} : { label }), shared: true });
        // A progressive override still sends a share to the subgraph it moves the field from.
        if (label !== undefined && from !== undefined && !owners.some((each) => each.subgraph === from)) owners.push({ subgraph: from, shared: true });
      }
      made.fields.set(field.name, {
        type: declared?.type ?? 'Unknown',
        ...(declared?.args === undefined ? {} : { args: declared.args }),
        owners,
        inaccessible: field.directives.some((directive) => directive.name === 'inaccessible'),
        ...(lineAt(field.at) === undefined ? {} : { line: lineAt(field.at) as number }),
      });
    }
  }
  return { composition: finish(schema.roots, graphs.map((graph) => graph.name), types), graphs };
};

/**
 * Fields an entity call would have to fetch from a subgraph that cannot be
 * called for the entity: the subgraph resolves a field of it beside the key,
 * declares no key the entity can be fetched by, and another subgraph hands
 * the entity out. Composition refuses that graph (it cannot be satisfied).
 */
export const unreachableOwners = (composition: Composition): CompositionConflict[] => {
  const handedOut = new Map<string, Set<string>>();
  for (const type of Object.values(composition.types)) {
    for (const field of Object.values(type.fields)) {
      const returned = field.type.replace(/[[\]!]/g, '');
      const by = handedOut.get(returned) ?? new Set<string>();
      for (const owner of field.owners) by.add(owner.subgraph);
      handedOut.set(returned, by);
    }
  }
  const found: CompositionConflict[] = [];
  for (const [name, type] of Object.entries(composition.types)) {
    if (type.kind !== 'object' || Object.values(composition.roots).includes(name)) continue;
    const keyed = new Set(Object.keys(type.keys ?? {}));
    // A value type is no entity: nothing fetches it by a key.
    if (keyed.size === 0) continue;
    const keyFields = new Set(Object.values({ ...type.keys, ...type.stubs }).flat().flatMap(fieldSetNames));
    for (const [field, composed] of Object.entries(type.fields)) {
      if (keyFields.has(field)) continue;
      for (const owner of composed.owners) {
        if (keyed.has(owner.subgraph)) continue;
        const others = [...(handedOut.get(name) ?? [])].filter((subgraph) => subgraph !== owner.subgraph);
        if (others.length > 0) found.push({ kind: 'unreachable', type: name, field, subgraphs: [owner.subgraph] });
      }
    }
  }
  return found;
};

/**
 * The schema the router serves, as P232's endpoints carry one: the composed
 * types and fields, an `@inaccessible` one marked so a selection of it can be
 * told from one of a field nobody has (D8).
 */
export const apiSchemaOf = (composition: Composition): SchemaSummary => ({
  roots: composition.roots,
  types: Object.fromEntries(
    Object.entries(composition.types).map(([name, type]): [string, SchemaType] => [
      name,
      {
        kind: type.kind,
        fields: Object.fromEntries(
          Object.entries(type.fields).map(([field, composed]): [string, SchemaField] => [
            field,
            {
              type: composed.type,
              ...(composed.args === undefined ? {} : { args: composed.args }),
              ...(composed.inaccessible === true ? { federation: { inaccessible: true as const } } : {}),
            },
          ]),
        ),
        ...(type.possible === undefined ? {} : { possible: type.possible }),
        ...(type.inaccessible === true ? { federation: { inaccessible: true as const } } : {}),
      },
    ]),
  ),
});
