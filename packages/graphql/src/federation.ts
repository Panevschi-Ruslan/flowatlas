import { argumentOf, parseDocument, stringsOf, tryParse, type AppliedDirective, type Document, type Selection, type Value } from './parse.js';
import { authOf, mergeAuth, schemaOf, selectionText, type AuthRequirement, type SchemaField, type SchemaSummary, type SchemaType } from './schema.js';

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
 * And what federation adds on top of fields and keys (P245): an entity
 * interface one subgraph owns and others add fields to as an
 * `@interfaceObject`, whose fields every implementation then has; the
 * contexts a type sets for an argument below it (`@context`, `@fromContext`);
 * the router's authorization directives (`@authenticated`,
 * `@requiresScopes`, `@policy`); and the directives of their own subgraphs
 * compose into the supergraph (`@composeDirective`).
 *
 * Plain data, so it can travel on a gateway's endpoint in `meta`.
 */

/** An argument the router fills from an ancestor's fields: the context it is taken from, and what it selects there (P245). */
export interface ContextArgument {
  readonly argument: string;
  /** The context, qualified by the subgraph that sets it, as a supergraph writes it: `accounts__viewer`. */
  readonly context: string;
  /** The fields it selects of the type that sets the context: `currency { code }`. */
  readonly selection: string;
}

/** One subgraph that resolves a field, and what it says it needs or gives. */
export interface FieldOwner {
  readonly subgraph: string;
  /** `@requires(fields:)`: fields of the entity fetched from their owners first. */
  readonly requires?: string;
  /** `@provides(fields:)`: fields of what it returns that it resolves too. */
  readonly provides?: string;
  /** A progressive `@override(label:)`: the field is moved here for a share of requests only. */
  readonly label?: string;
  /**
   * The type the subgraph resolves the field under, where it is not the
   * field's own: the interface an `@interfaceObject` stands for, which is the
   * only one of the interface's types that subgraph knows (P245).
   */
  readonly as?: string;
  /** Arguments filled from an ancestor (`@fromContext`), planned before the field (P245). */
  readonly context?: readonly ContextArgument[];
}

export interface ComposedField {
  readonly type: string;
  readonly args?: SchemaField['args'];
  readonly owners: readonly FieldOwner[];
  /** Hidden from the API the router serves (`@inaccessible`). */
  readonly inaccessible?: true;
  /** Its line in the supergraph it was read from, where it was read from one. */
  readonly line?: number;
  /** What the router asks of a request before it resolves the field (P245). */
  readonly auth?: readonly AuthRequirement[];
  /** The composed directives of the subgraphs it carries, by name (P245). */
  readonly directives?: readonly string[];
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
  /** The subgraphs that know this interface only as an `@interfaceObject` (P245). */
  readonly interfaceObjects?: readonly string[];
  /** The contexts it sets for the fields below it, qualified by subgraph (P245). */
  readonly contexts?: readonly string[];
  /** What the router asks of a request for any field of it, or that returns it (P245). */
  readonly auth?: readonly AuthRequirement[];
  readonly directives?: readonly string[];
}

export interface Composition {
  readonly roots: SchemaSummary['roots'];
  readonly subgraphs: readonly string[];
  readonly types: Readonly<Record<string, ComposedType>>;
  /** The directives the subgraphs compose into the supergraph (`@composeDirective`), with who composes them (P245). */
  readonly directives?: Readonly<Record<string, { readonly subgraphs?: readonly string[]; readonly url?: string }>>;
}

/**
 * Something composition would refuse: a field owned by several subgraphs
 * that do not all share it (`shared`); a field owned by a subgraph an entity
 * call cannot reach, since it declares no key the entity can be fetched by
 * while other subgraphs hand the entity out (`unreachable`); a directive
 * composed that its subgraph never defines, or that two subgraphs take from
 * different specifications (`directive`, P245: `type` is the directive,
 * `detail` says which).
 */
export interface CompositionConflict {
  readonly kind: 'shared' | 'unreachable' | 'directive';
  readonly type: string;
  readonly field: string;
  readonly subgraphs: readonly string[];
  /** For a directive: the specifications it is taken from, where they differ. */
  readonly urls?: readonly string[];
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

type BuildingOwner = FieldOwner & { shared: boolean; override?: { from: string; label?: string } };

interface BuildingField {
  type: string;
  args?: SchemaField['args'];
  owners: BuildingOwner[];
  inaccessible: boolean;
  line?: number;
  auth: AuthRequirement[];
  directives: Set<string>;
  /** The owners are the type's subgraphs, no `@join__field` naming any. */
  defaulted?: true;
}

/** A builder of one composed type, filled subgraph by subgraph. */
interface Building {
  kind: SchemaType['kind'];
  fields: Map<string, BuildingField>;
  keys: Map<string, string[]>;
  stubs: Map<string, string[]>;
  possible: Set<string>;
  inaccessible: boolean;
  interfaceObjects: Set<string>;
  contexts: Set<string>;
  auth: AuthRequirement[];
  directives: Set<string>;
}

const building = (kind: SchemaType['kind']): Building => ({
  kind,
  fields: new Map(),
  keys: new Map(),
  stubs: new Map(),
  possible: new Set(),
  inaccessible: false,
  interfaceObjects: new Set(),
  contexts: new Set(),
  auth: [],
  directives: new Set(),
});

const sorted = (values: Iterable<string>): string[] => [...values].sort(cmp);

const finish = (
  roots: SchemaSummary['roots'],
  subgraphs: readonly string[],
  types: ReadonlyMap<string, Building>,
  directives: Composition['directives'] = {},
): Composition => ({
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
                ...(made.auth.length === 0 ? {} : { auth: made.auth }),
                ...(made.directives.size === 0 ? {} : { directives: sorted(made.directives) }),
              },
            ]),
          ),
          ...(type.keys.size === 0 ? {} : { keys: Object.fromEntries([...type.keys.entries()].sort(([a], [b]) => cmp(a, b))) }),
          ...(type.stubs.size === 0 ? {} : { stubs: Object.fromEntries([...type.stubs.entries()].sort(([a], [b]) => cmp(a, b))) }),
          ...(type.possible.size === 0 ? {} : { possible: sorted(type.possible) }),
          ...(type.inaccessible ? { inaccessible: true as const } : {}),
          ...(type.interfaceObjects.size === 0 ? {} : { interfaceObjects: sorted(type.interfaceObjects) }),
          ...(type.contexts.size === 0 ? {} : { contexts: sorted(type.contexts) }),
          ...(type.auth.length === 0 ? {} : { auth: type.auth }),
          ...(type.directives.size === 0 ? {} : { directives: sorted(type.directives) }),
        },
      ]),
  ),
  ...(Object.keys(directives).length === 0 ? {} : { directives: Object.fromEntries(Object.entries(directives).sort(([a], [b]) => cmp(a, b))) }),
});

/**
 * What an `@interfaceObject` adds to an interface, given to every type that
 * implements it (P245): the subgraph knows none of those types, only the
 * interface, so it resolves the field of a `Book` as the field of a `Media`,
 * after an entity call for the `Media` - which is what `as` says. A field an
 * implementation's own `@join__field` gives to a subgraph keeps it; one the
 * supergraph leaves to the type's subgraphs, or to nobody (a bare
 * `@join__field`), is the interface object's.
 */
const spreadInterfaceObjects = (types: Map<string, Building>): void => {
  for (const [name, made] of types) {
    if (made.interfaceObjects.size === 0) continue;
    for (const [field, composed] of made.fields) {
      const carried = composed.owners.filter((owner) => made.interfaceObjects.has(owner.subgraph));
      if (carried.length === 0) continue;
      const only = carried.length === composed.owners.length;
      for (const member of made.possible) {
        const target = types.get(member);
        if (target === undefined) continue;
        const into = target.fields.get(field) ?? { type: composed.type, ...(composed.args === undefined ? {} : { args: composed.args }), owners: [], inaccessible: composed.inaccessible, auth: [...composed.auth], directives: new Set(composed.directives) };
        target.fields.set(field, into);
        if (into.defaulted === true && only) {
          into.owners = [];
          delete into.defaulted;
        }
        for (const owner of carried) if (!into.owners.some((each) => each.subgraph === owner.subgraph)) into.owners.push({ ...owner, as: name, shared: true });
        into.auth = mergeAuth(into.auth, composed.auth);
      }
    }
  }
};

/** A specification's major version and identity, from its URL: `https://example.dev/audit/v1.2` is `https://example.dev/audit/v1`. */
const specIdentity = (url: string): string => url.replace(/(\/v\d+)\.\d+\/?$/, '$1');

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
 *
 * A type one subgraph declares an interface and another an
 * `@interfaceObject` is the interface, its implementations given the
 * interface object's fields (P245). A context is qualified by the subgraph
 * that sets it, as the supergraph does, since `@fromContext` names a context
 * of its own subgraph only.
 */
export const composeSubgraphs = (subgraphs: readonly SubgraphSchema[]): { composition: Composition; conflicts: CompositionConflict[] } => {
  const types = new Map<string, Building>();
  const entities = new Set<string>();
  for (const { schema } of subgraphs) for (const [name, type] of Object.entries(schema.types)) if ((type.federation?.keys?.length ?? 0) > 0) entities.add(name);
  const ordered = [...subgraphs].sort((a, b) => cmp(a.name, b.name));
  const conflicts: CompositionConflict[] = [];
  const composedDirectives = new Map<string, Map<string, string[]>>();
  for (const { name: subgraph, schema } of ordered) {
    for (const directive of schema.composeDirectives ?? []) {
      if (!directive.defined) conflicts.push({ kind: 'directive', type: `@${directive.name}`, field: '', subgraphs: [subgraph] });
      const byUrl = composedDirectives.get(directive.name) ?? new Map<string, string[]>();
      composedDirectives.set(directive.name, byUrl);
      byUrl.set(directive.url ?? '', [...(byUrl.get(directive.url ?? '') ?? []), subgraph]);
    }
    const roots = new Map<string, string>();
    for (const [operation, type] of Object.entries(schema.roots)) if (type !== undefined) roots.set(type, ROOT_NAMES[operation as keyof typeof ROOT_NAMES]);
    for (const [written, type] of Object.entries(schema.types)) {
      if (isMachinery(written)) continue;
      const name = roots.get(written) ?? written;
      const root = roots.has(written) || Object.values(ROOT_NAMES).includes(name as never);
      const made = types.get(name) ?? building(type.kind);
      types.set(name, made);
      // The subgraph that owns the interface says what it is; an interface object only adds to it.
      if (type.kind === 'interface') made.kind = 'interface';
      for (const member of type.possible ?? []) made.possible.add(member);
      if (type.federation?.inaccessible === true) made.inaccessible = true;
      if (type.federation?.interfaceObject === true) made.interfaceObjects.add(subgraph);
      for (const context of type.federation?.contexts ?? []) made.contexts.add(`${subgraph}__${context}`);
      made.auth = mergeAuth(made.auth, type.federation?.auth);
      for (const directive of type.federation?.directives ?? []) made.directives.add(directive);
      const keyFields = new Set<string>();
      for (const key of type.federation?.keys ?? []) {
        const into = key.resolvable === false ? made.stubs : made.keys;
        into.set(subgraph, [...(into.get(subgraph) ?? []), key.fields]);
        for (const field of fieldSetNames(key.fields)) keyFields.add(field);
      }
      for (const [field, declared] of Object.entries(type.fields ?? {})) {
        if (root && field.startsWith('_')) continue;
        const composed = made.fields.get(field) ?? { type: declared.type, ...(declared.args === undefined ? {} : { args: declared.args }), owners: [], inaccessible: false, auth: [], directives: new Set<string>() };
        made.fields.set(field, composed);
        const federation = declared.federation;
        if (federation?.inaccessible === true) composed.inaccessible = true;
        // A key field marked external arrives in the representation; it is
        // nobody's to resolve, and the plan keeps it where it is (D4).
        if (federation?.external === true) continue;
        composed.auth = mergeAuth(composed.auth, federation?.auth);
        for (const directive of federation?.directives ?? []) composed.directives.add(directive);
        const version = schema.federation ?? 1;
        // Only an object's fields are resolved; an input, an enum or an
        // interface declared in two subgraphs is merged, never refused.
        const shared =
          type.kind !== 'object' ||
          keyFields.has(field) ||
          federation?.shareable === true ||
          type.federation?.shareable === true ||
          (version === 1 && !root && !entities.has(name));
        const context = Object.entries(federation?.fromContext ?? {}).map(([argument, from]): ContextArgument => ({ argument, context: `${subgraph}__${from.context}`, selection: from.selection }));
        composed.owners.push({
          subgraph,
          ...(federation?.requires === undefined ? {} : { requires: federation.requires }),
          ...(federation?.provides === undefined ? {} : { provides: federation.provides }),
          ...(context.length === 0 ? {} : { context }),
          shared,
          ...(federation?.override === undefined ? {} : { override: federation.override }),
        });
      }
    }
  }
  spreadInterfaceObjects(types);
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
  // One directive composed from two specifications, or two major versions of one, is refused (P245).
  const directives: Record<string, { subgraphs: string[]; url?: string }> = {};
  for (const [name, byUrl] of composedDirectives) {
    const urls = sorted([...byUrl.keys()].filter((url) => url !== ''));
    if (new Set(urls.map(specIdentity)).size > 1) conflicts.push({ kind: 'directive', type: `@${name}`, field: '', subgraphs: sorted(new Set([...byUrl.values()].flat())), urls });
    const [url] = urls.slice(-1);
    directives[name] = { subgraphs: sorted(new Set([...byUrl.values()].flat())), ...(url === undefined ? {} : { url }) };
  }
  const roots = { query: 'Query', ...(types.has('Mutation') ? { mutation: 'Mutation' } : {}), ...(types.has('Subscription') ? { subscription: 'Subscription' } : {}) };
  return { composition: finish(roots, subgraphs.map((each) => each.name), types, directives), conflicts };
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

/** The specifications of the router's own a supergraph links, beside federation's (P245). */
const ROUTER_SPECS = /specs\.apollo\.dev\/(authenticated|requiresScopes|policy|context)\/v\d/;

/** Directives a supergraph defines that are the specification's or the language's, never a subgraph's composed one. */
const KNOWN_DIRECTIVES = new Set(['link', 'inaccessible', 'tag', 'cost', 'listSize', 'deprecated', 'specifiedBy', 'oneOf', 'defer', 'stream', 'include', 'skip', 'authenticated', 'requiresScopes', 'policy', 'context']);

/**
 * What each directive a supergraph writes is, by the name it is used under:
 * the router's specifications are linked with `@link(url:)`, maybe under
 * another name (`as:`, `import: [{ name, as }]`); every other directive the
 * supergraph defines is one a subgraph composed, with the URL its link names.
 */
const supergraphNamesOf = (document: Document): { canonical: (name: string) => string; composed: ReadonlyMap<string, string | undefined> } => {
  const renamed = new Map<string, string>();
  const linkedFrom = new Map<string, string>();
  for (const definition of document.definitions) {
    if (definition.kind !== 'schema') continue;
    for (const link of definition.directives) {
      if (link.name !== 'link') continue;
      const url = stringsOf(argumentOf(link, 'url'))[0] ?? '';
      const spec = ROUTER_SPECS.exec(url)?.[1];
      if (spec !== undefined) renamed.set(stringsOf(argumentOf(link, 'as'))[0] ?? spec, spec);
      const imports = argumentOf(link, 'import');
      for (const item of imports?.kind === 'list' ? imports.items : []) {
        const name = (item.kind === 'string' ? item.value : item.kind === 'object' ? stringsOf(item.fields['name'])[0] : undefined)?.replace(/^@/, '');
        const as = (item.kind === 'object' ? stringsOf(item.fields['as'])[0] : undefined)?.replace(/^@/, '');
        if (name === undefined) continue;
        if (spec !== undefined) renamed.set(as ?? name, name);
        else linkedFrom.set(as ?? name, url);
      }
    }
  }
  const canonical = (name: string): string => renamed.get(name) ?? name;
  const composed = new Map<string, string | undefined>();
  for (const definition of document.definitions) {
    if (definition.kind !== 'directive') continue;
    const name = canonical(definition.name);
    if (name.includes('__') || KNOWN_DIRECTIVES.has(name)) continue;
    composed.set(definition.name, linkedFrom.get(definition.name));
  }
  return { canonical, composed };
};

/** The arguments a supergraph's `@join__field(contextArguments:)` fills from a context. */
const contextArgumentsOf = (value: Value | undefined): ContextArgument[] =>
  (value?.kind === 'list' ? value.items : []).flatMap((item): ContextArgument[] => {
    if (item.kind !== 'object') return [];
    const argument = stringsOf(item.fields['name'])[0];
    const context = stringsOf(item.fields['context'])[0];
    const selection = stringsOf(item.fields['selection'])[0];
    return argument === undefined || context === undefined || selection === undefined ? [] : [{ argument, context, selection: selectionText(selection) }];
  });

/**
 * The composition a supergraph writes down (D3): the subgraphs from
 * `enum join__Graph`, each type's subgraphs and keys from `@join__type` (and
 * `@join__owner` in the first version of the join specification), each
 * field's from `@join__field` - a field with none belongs to every subgraph
 * of its type - leaving out `external: true` and an overridden field no
 * longer used.
 *
 * And (P245) an interface a subgraph knows as an object
 * (`@join__type(isInterfaceObject: true)`), a bare `@join__field` on an
 * implementation's field the interface object resolves, the arguments a
 * field takes from a context (`contextArguments`), the contexts a type sets,
 * the router's authorization directives and the directives the subgraphs
 * composed.
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
  const names = supergraphNamesOf(document);
  /** What the directives written on a type or a field say beside the join: authorization, contexts, composed directives. */
  const read = (applied: readonly AppliedDirective[]): { auth: AuthRequirement[]; contexts: string[]; directives: string[] } => {
    const found = { auth: [] as AuthRequirement[], contexts: [] as string[], directives: [] as string[] };
    for (const directive of applied) {
      const name = names.canonical(directive.name);
      const requirement = authOf(name, directive);
      if (requirement !== undefined) found.auth.push(requirement);
      if (name === 'context') found.contexts.push(...stringsOf(argumentOf(directive, 'name')));
      if (names.composed.has(directive.name) && !found.directives.includes(directive.name)) found.directives.push(directive.name);
    }
    return { ...found, auth: mergeAuth(found.auth) };
  };
  const schema = schemaOf([document]);
  const types = new Map<string, Building>();
  for (const definition of document.definitions) {
    if (definition.kind !== 'type' || isMachinery(definition.name) || definition.of === 'scalar') continue;
    const made = types.get(definition.name) ?? building(definition.of);
    types.set(definition.name, made);
    for (const member of schema.types[definition.name]?.possible ?? []) made.possible.add(member);
    if (definition.directives.includes('inaccessible')) made.inaccessible = true;
    const own = read(definition.applied);
    made.auth = mergeAuth(made.auth, own.auth);
    for (const context of own.contexts) made.contexts.add(context);
    for (const directive of own.directives) made.directives.add(directive);
    const typeGraphs: string[] = [];
    let owner: string | undefined;
    for (const directive of definition.applied) {
      const graph = graphArgument(directive);
      const name = graph === undefined ? undefined : (byValue.get(graph) ?? graph.toLowerCase());
      if (name === undefined) continue;
      if (directive.name === 'join__owner') owner = name;
      if (directive.name !== 'join__type') continue;
      if (!typeGraphs.includes(name)) typeGraphs.push(name);
      if (isTrue(argumentOf(directive, 'isInterfaceObject'))) made.interfaceObjects.add(name);
      const key = stringsOf(argumentOf(directive, 'key'))[0];
      if (key === undefined) continue;
      const into = argumentOf(directive, 'resolvable')?.kind === 'literal' && (argumentOf(directive, 'resolvable') as { text: string }).text === 'false' ? made.stubs : made.keys;
      into.set(name, [...(into.get(name) ?? []), key]);
    }
    const defaults = owner === undefined ? typeGraphs : [owner];
    for (const field of definition.fields) {
      const declared = schema.types[definition.name]?.fields?.[field.name];
      const joins = field.directives.filter((directive) => directive.name === 'join__field' && graphArgument(directive) !== undefined);
      // `@join__field` naming no graph: no subgraph resolves the field as the type's own (an interface object's, P245).
      const bare = field.directives.some((directive) => directive.name === 'join__field' && graphArgument(directive) === undefined);
      const owners: BuildingOwner[] = [];
      if (joins.length === 0 && !bare) for (const graph of defaults) owners.push({ subgraph: graph, shared: true });
      for (const join of joins) {
        if (isTrue(argumentOf(join, 'external')) || isTrue(argumentOf(join, 'usedOverridden'))) continue;
        const graph = graphArgument(join) as string;
        const requires = stringsOf(argumentOf(join, 'requires'))[0];
        const provides = stringsOf(argumentOf(join, 'provides'))[0];
        const label = stringsOf(argumentOf(join, 'overrideLabel'))[0];
        const from = stringsOf(argumentOf(join, 'override'))[0];
        const context = contextArgumentsOf(argumentOf(join, 'contextArguments'));
        owners.push({
          subgraph: byValue.get(graph) ?? graph.toLowerCase(),
          ...(requires === undefined ? {} : { requires }),
          ...(provides === undefined ? {} : { provides }),
          ...(label === undefined ? {} : { label }),
          ...(context.length === 0 ? {} : { context }),
          shared: true,
        });
        // A progressive override still sends a share to the subgraph it moves the field from.
        if (label !== undefined && from !== undefined && !owners.some((each) => each.subgraph === from)) owners.push({ subgraph: from, shared: true });
      }
      const said = read(field.directives);
      made.fields.set(field.name, {
        type: declared?.type ?? 'Unknown',
        ...(declared?.args === undefined ? {} : { args: declared.args }),
        owners,
        inaccessible: field.directives.some((directive) => directive.name === 'inaccessible'),
        ...(lineAt(field.at) === undefined ? {} : { line: lineAt(field.at) as number }),
        auth: said.auth,
        directives: new Set(said.directives),
        ...(joins.length === 0 && !bare ? { defaulted: true as const } : {}),
      });
    }
  }
  spreadInterfaceObjects(types);
  const directives = Object.fromEntries([...names.composed].map(([name, url]) => [name, url === undefined ? {} : { url }]));
  return { composition: finish(schema.roots, graphs.map((graph) => graph.name), types, directives), graphs };
};

/**
 * Fields an entity call would have to fetch from a subgraph that cannot be
 * called for the entity: the subgraph resolves a field of it beside the key,
 * declares no key the entity can be fetched by, and another subgraph hands
 * the entity out. Composition refuses that graph (it cannot be satisfied).
 * An interface object's field is fetched as the interface, by the interface's
 * key in that subgraph (P245).
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
        if (owner.as !== undefined && (composition.types[owner.as]?.keys?.[owner.subgraph]?.length ?? 0) > 0) continue;
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
 * told from one of a field nobody has (D8). An argument the router fills
 * from a context is not the client's to pass, and is not in it (P245).
 */
export const apiSchemaOf = (composition: Composition): SchemaSummary => ({
  roots: composition.roots,
  types: Object.fromEntries(
    Object.entries(composition.types).map(([name, type]): [string, SchemaType] => [
      name,
      {
        kind: type.kind,
        fields: Object.fromEntries(
          Object.entries(type.fields).map(([field, composed]): [string, SchemaField] => {
            const filled = new Set(composed.owners.flatMap((owner) => (owner.context ?? []).map((each) => each.argument)));
            const args = composed.args === undefined ? undefined : Object.fromEntries(Object.entries(composed.args).filter(([arg]) => !filled.has(arg)));
            return [
              field,
              {
                type: composed.type,
                ...(args === undefined || Object.keys(args).length === 0 ? {} : { args }),
                ...(composed.inaccessible === true ? { federation: { inaccessible: true as const } } : {}),
              },
            ];
          }),
        ),
        ...(type.possible === undefined ? {} : { possible: type.possible }),
        ...(type.directives === undefined ? {} : { directives: type.directives }),
        ...(type.inaccessible === true ? { federation: { inaccessible: true as const } } : {}),
      },
    ]),
  ),
});

/** A context as a person wrote it, without the subgraph composition put in front: `accounts__viewer` is `viewer`. */
export const contextName = (qualified: string): string => qualified.replace(/^.*?__/, '');
