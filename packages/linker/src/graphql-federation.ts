import {
  ACCESS_META,
  accessOf,
  CONFIDENCE_RANK,
  makeEntryId,
  makeSymbolId,
  type AccessGuard,
  type Confidence,
  type GraphEdge,
  type GraphNode,
  type Unresolved,
} from '@flowatlas/core';
import {
  apiSchemaOf,
  authLabel,
  composeSubgraphs,
  GRAPHQL_META,
  mergeAuth,
  namedTypeIn,
  unreachableOwners,
  type AuthRequirement,
  type Composition,
  type CompositionConflict,
  type GatewayMeta,
  type GatewayRouteMeta,
  type SchemaSummary,
} from '@flowatlas/graphql';
import { DECLARED_BY } from './document/declared.js';
import { cmp, edgeKey } from './order.js';

/**
 * A federation gateway's routes and composition, joined (P241).
 *
 * Runs after every request is joined to its route, and before the fields of
 * any request are joined (`joinGraphqlFields`), which plans a request to a
 * gateway with what is worked out here:
 *
 * 1. **Routes.** Each subgraph the gateway names is joined to the service
 *    its address reaches, as a request's address is (D2) - the setting's
 *    claimant or its values, the host - and the gateway's endpoint gets an
 *    `http_calls` edge to that service's GraphQL endpoint, at the line that
 *    names the subgraph. An address that reaches nothing is a row.
 * 2. **Composition.** A supergraph wrote it down (`meta.graphql.gateway
 *    .composition`) and is checked against the subgraphs' source; otherwise
 *    the subgraphs' schemas are composed here, and what composition would
 *    refuse is a row (D3, D4). The gateway's endpoint is given the composed
 *    API schema, so the contract compares a selection through it with what
 *    the composition has (D8).
 * 3. **The router's checks** (P245). A field the router's authorization
 *    directives guard (`@authenticated`, `@requiresScopes`, `@policy`, on the
 *    field, its type or the type it returns) gets a `guarded_by` edge from
 *    each subgraph entry that resolves it to the check, a `guard` node of the
 *    router, and the check on the entry's `meta.access` - the shape every
 *    other reader gives a check in front of a way in. Only a router checks
 *    them: composed by an Apollo Gateway in code they guard nothing, and that
 *    is a row.
 * 4. **Subgraphs no gateway names**, said once each.
 */

/** Where a subgraph's address goes: a service, with how sure the join is, or why none. */
export type RouteAnswer =
  | { readonly service: string; readonly confidence: Confidence }
  | { readonly why: string };

/** A subgraph joined: the service, its GraphQL endpoint, and how sure the join is. */
export interface SubgraphRoute {
  readonly service: string;
  readonly endpoint: GraphNode;
  readonly confidence: Confidence;
}

/** What a request to one gateway is planned with. */
export interface GatewayPlan {
  readonly gateway: GraphNode;
  readonly composition: Composition;
  /** How sure the composition is: as read, or `heuristic` where a subgraph was not read. */
  readonly confidence: Confidence;
  readonly routes: ReadonlyMap<string, SubgraphRoute>;
}

/** One port a GraphQL server listens on, and where its code says so (P245). */
export interface Listening {
  readonly service: string;
  readonly file: string;
  readonly line: number;
  readonly setting?: string;
}

/**
 * Every port the GraphQL servers of the project listen on, as their code
 * writes it (P245): where a gateway names a subgraph at `localhost:4001`,
 * the service that listens on 4001 is the subgraph, with no host configured.
 */
export const listeningAt = (nodes: ReadonlyMap<string, GraphNode>): Map<number, Listening[]> => {
  const found = new Map<number, Listening[]>();
  for (const node of nodes.values()) {
    if (node.type !== 'entry' || node.kind !== 'http') continue;
    const listen = (node.meta?.[GRAPHQL_META] as { listen?: ReadonlyArray<{ port: number; file: string; line: number; setting?: string }> } | undefined)?.listen;
    for (const port of listen ?? []) {
      const list = found.get(port.port) ?? [];
      if (!list.some((each) => each.service === node.repo)) list.push({ service: node.repo, file: port.file, line: port.line, ...(port.setting === undefined ? {} : { setting: port.setting }) });
      found.set(port.port, list.sort((a, b) => cmp(a.service, b.service)));
    }
  }
  return found;
};

/** The weakest of some confidences: an edge is no surer than what it rests on. */
export const weakest = (...levels: readonly Confidence[]): Confidence =>
  levels.reduce((low, level) => (CONFIDENCE_RANK[level] < CONFIDENCE_RANK[low] ? level : low), 'static' as Confidence);

const servedOf = (node: GraphNode | undefined): { endpoint?: boolean; schema?: SchemaSummary; gateway?: GatewayMeta; subgraph?: { federation: number } } | undefined =>
  node?.meta?.[GRAPHQL_META] as { endpoint?: boolean; schema?: SchemaSummary; gateway?: GatewayMeta; subgraph?: { federation: number } } | undefined;

/** A path as a GraphQL endpoint is matched on: no trailing slash, the root as `/`. */
const pathOf = (path: string): string => {
  const trimmed = path.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
};

/**
 * The GraphQL endpoint of a service a subgraph's address asks for: the one
 * at its path, or the service's only one where the address names no path or
 * the server answers at its root whatever is asked (a standalone server).
 */
const endpointAt = (endpoints: readonly GraphNode[], path: string): GraphNode | undefined => {
  const asked = pathOf(path);
  const exact = endpoints.find((endpoint) => pathOf(String(endpoint.meta?.['path'] ?? '')) === asked);
  if (exact !== undefined) return exact;
  const [only, ...more] = endpoints;
  if (only === undefined || more.length > 0) return undefined;
  return path === '' || pathOf(String(only.meta?.['path'] ?? '')) === '/' ? only : undefined;
};

/** Every GraphQL endpoint of every service. */
const endpointsByService = (nodes: ReadonlyMap<string, GraphNode>): Map<string, GraphNode[]> => {
  const found = new Map<string, GraphNode[]>();
  for (const node of nodes.values()) {
    if (node.type !== 'entry' || node.kind !== 'http' || servedOf(node)?.endpoint !== true) continue;
    found.set(node.repo, [...(found.get(node.repo) ?? []), node]);
  }
  return found;
};

/** The way a root type of a subgraph is named in the composition: `Query`, whatever the subgraph calls it. */
const rootsOf = (schema: SchemaSummary): Map<string, string> => {
  const names = new Map<string, string>();
  for (const [operation, type] of Object.entries(schema.roots)) {
    if (type !== undefined) names.set(type, operation === 'query' ? 'Query' : operation === 'mutation' ? 'Mutation' : 'Subscription');
  }
  return names;
};

/** One place a supergraph and a subgraph's source disagree. */
interface Drift {
  readonly field: string;
  /** The supergraph gives the subgraph a field its source does not declare, or the source declares a root field the supergraph lacks. */
  readonly missing: 'source' | 'supergraph';
  readonly line?: number;
}

/**
 * Where a supergraph and a subgraph's source disagree: a field the supergraph
 * gives the subgraph and its source does not declare, and a root field the
 * source declares and the supergraph does not have.
 */
const driftOf = (composition: Composition, subgraph: string, schema: SchemaSummary): Drift[] => {
  const roots = rootsOf(schema);
  const declared = new Map<string, ReadonlySet<string>>();
  for (const [written, type] of Object.entries(schema.types)) declared.set(roots.get(written) ?? written, new Set(Object.keys(type.fields ?? {})));
  const found: Drift[] = [];
  for (const [name, type] of Object.entries(composition.types)) {
    for (const [field, composed] of Object.entries(type.fields)) {
      const owner = composed.owners.find((each) => each.subgraph === subgraph);
      if (owner === undefined) continue;
      // An interface object's field is declared on the interface it stands for (P245).
      if (owner.as !== undefined && owner.as !== name) continue;
      // A type the subgraph's source does not declare at all was not read, and is not said to be missing.
      const fields = declared.get(name);
      if (fields !== undefined && fields.size > 0 && !fields.has(field)) found.push({ field: `${name}.${field}`, missing: 'source', ...(composed.line === undefined ? {} : { line: composed.line }) });
    }
  }
  for (const root of ['Query', 'Mutation', 'Subscription']) {
    for (const field of declared.get(root) ?? []) {
      if (field.startsWith('_')) continue;
      if (composition.types[root]?.fields[field] === undefined) found.push({ field: `${root}.${field}`, missing: 'supergraph' });
    }
  }
  return found.sort((a, b) => cmp(a.field, b.field));
};

const conflictSentence = (conflict: CompositionConflict): string =>
  conflict.kind === 'shared'
    ? `${conflict.type}.${conflict.field} is resolved by ${conflict.subgraphs.join(' and ')}, and not every one of them marks it @shareable; composition refuses two owners of one field`
    : conflict.kind === 'directive'
      ? conflict.urls === undefined
        ? `${conflict.subgraphs[0] ?? '?'} composes ${conflict.type} into the supergraph (@composeDirective), and neither defines it nor imports it from a linked specification; composition refuses a directive it cannot find`
        : `${conflict.subgraphs.join(' and ')} compose ${conflict.type} from different specifications (${conflict.urls.join(', ')}); composition keeps one definition of a directive, and refuses two`
      : `${conflict.subgraphs[0] ?? '?'} resolves ${conflict.type}.${conflict.field} but declares no key ${conflict.type} can be fetched by there, so an entity call from another subgraph cannot reach it`;

const conflictHint = (conflict: CompositionConflict): string =>
  conflict.kind === 'shared'
    ? `Mark ${conflict.type}.${conflict.field} @shareable in every subgraph that resolves it, or move it to one of them with @override(from:).`
    : conflict.kind === 'directive'
      ? conflict.urls === undefined
        ? `Define ${conflict.type} in ${conflict.subgraphs[0] ?? 'the subgraph'} (directive ${conflict.type}(...) on ...), or import it with @link(url:, import: ["${conflict.type}"]).`
        : `Link ${conflict.type} from one specification, at one major version, in every subgraph that composes it.`
      : `Declare @key on ${conflict.type} in ${conflict.subgraphs[0] ?? 'the subgraph'}, or move the field to a subgraph that does.`;

/** What the router asks of a request for a field: written on the field, on its type, or on the type it returns (P245). */
const authOfField = (composition: Composition, type: string, field: string): AuthRequirement[] => {
  const composed = composition.types[type]?.fields[field];
  if (composed === undefined) return [];
  return mergeAuth(composed.auth, composition.types[type]?.auth, composition.types[namedTypeIn(composed.type)]?.auth);
};

/** A check's kind, as a person names it: `@requiresScopes` of `@requiresScopes(read:orders)`. */
const directiveOf = (label: string): string => label.replace(/\(.*$/, '');

/**
 * The router's checks in front of the fields they guard (P245): one `guard`
 * node of the router per requirement, a `guarded_by` edge to it from each
 * subgraph entry that resolves a guarded field, in the order written, and
 * the check on the entry's `meta.access`. An entry two fields reach (an
 * interface object's field, under the interface and each implementation) is
 * guarded once by each requirement.
 */
const guardFields = (
  nodes: Map<string, GraphNode>,
  edges: Map<string, GraphEdge>,
  gateway: GraphNode,
  meta: GatewayMeta,
  composition: Composition,
  routes: ReadonlyMap<string, SubgraphRoute>,
  confidence: Confidence,
): void => {
  const file = meta.from ?? gateway.file ?? '';
  if (file === '') return;
  const perEntry = new Map<string, Map<string, { requirement: AuthRequirement; field: string; line: number; confidence: Confidence }>>();
  // The interface's own field first, so a check is said where the entry has it, and an implementation's copy adds only what it adds.
  const owned = Object.entries(composition.types).flatMap(([typeName, type]) =>
    Object.entries(type.fields).flatMap(([field, composed]) => composed.owners.map((owner) => ({ typeName, field, composed, owner, copy: owner.as !== undefined && owner.as !== typeName }))),
  );
  for (const { typeName, field, composed, owner } of [...owned.filter((one) => !one.copy), ...owned.filter((one) => one.copy)]) {
    const required = authOfField(composition, typeName, field);
    const route = routes.get(owner.subgraph);
    if (required.length === 0 || route === undefined) continue;
    const resolved = `${owner.as ?? typeName}.${field}`;
    const entryId = makeEntryId(route.service, 'graphql', resolved);
    if (!nodes.has(entryId)) continue;
    const list = perEntry.get(entryId) ?? new Map();
    perEntry.set(entryId, list);
    for (const requirement of required) {
      if (list.has(authLabel(requirement))) continue;
      list.set(authLabel(requirement), { requirement, field: owner.as === undefined ? resolved : `${typeName}.${field}`, line: composed.line ?? gateway.line ?? 1, confidence: weakest(route.confidence, confidence) });
    }
  }
  for (const [entryId, list] of [...perEntry.entries()].sort(([a], [b]) => cmp(a, b))) {
    const entry = nodes.get(entryId) as GraphNode;
    const before = [...edges.values()].filter((edge) => edge.from === entryId && edge.type === 'guarded_by').length;
    const guards: AccessGuard[] = [];
    [...list.values()].forEach((one, index) => {
      const label = authLabel(one.requirement);
      const id = makeSymbolId(gateway.repo, file, label);
      if (!nodes.has(id)) {
        nodes.set(id, { id, type: 'guard', label, repo: gateway.repo, file, line: one.line, kind: 'directive', meta: { [GRAPHQL_META]: { gateway: gateway.repo, requirement: one.requirement } } });
      }
      const via = `${directiveOf(label)} on ${one.field}, checked by ${gateway.repo}`;
      const edge: GraphEdge = {
        from: entryId,
        to: id,
        type: 'guarded_by',
        confidence: one.confidence,
        // The router checks the requests that come through it, and no other (`through`).
        meta: { order: before + index, scope: 'route', layer: 'guard', source: via, through: gateway.repo, [GRAPHQL_META]: { gateway: gateway.repo, field: one.field } },
      };
      edges.set(edgeKey(edge), edge);
      guards.push({ id, name: label, layer: 'guard', where: 'route', via, file, line: one.line });
    });
    const access = accessOf(entry);
    entry.meta = { ...entry.meta, [ACCESS_META]: { ...access, guards: [...(access?.guards ?? []), ...guards] } };
  }
};

/** The fields a composition's authorization directives guard, as a row names them: `Media.rating @authenticated`. */
const guardedFields = (composition: Composition): string[] =>
  Object.entries(composition.types).flatMap(([typeName, type]) =>
    Object.keys(type.fields).flatMap((field) => {
      const required = authOfField(composition, typeName, field);
      // An implementation's copy of an interface object's field is the interface's, said once there.
      const copied = type.fields[field]?.owners.every((owner) => owner.as !== undefined && owner.as !== typeName) === true;
      return required.length === 0 || copied ? [] : [`${typeName}.${field} ${required.map(authLabel).join(' ')}`];
    }),
  );

export const routeGateways = (
  nodes: Map<string, GraphNode>,
  edges: Map<string, GraphEdge>,
  serviceOfRoute: (route: GatewayRouteMeta, gateway: GraphNode) => RouteAnswer,
): { plans: Map<string, GatewayPlan>; rows: Unresolved[] } => {
  const rows: Unresolved[] = [];
  const plans = new Map<string, GatewayPlan>();
  const endpoints = endpointsByService(nodes);
  const routed = new Set<string>();
  const gateways = [...nodes.values()].filter((node) => node.type === 'entry' && servedOf(node)?.gateway !== undefined).sort((a, b) => cmp(a.id, b.id));

  for (const gateway of gateways) {
    const meta = servedOf(gateway)?.gateway as GatewayMeta;
    if (meta.unread !== undefined) continue;
    const declared = gateway.meta?.[DECLARED_BY] !== undefined;
    const read: Confidence = declared ? 'declared' : 'static';
    const routes = new Map<string, SubgraphRoute>();
    const schemas: Array<{ name: string; schema: SchemaSummary }> = [];
    let partial = false;
    for (const route of meta.subgraphs) {
      const answer = serviceOfRoute(route, gateway);
      const endpoint = 'service' in answer ? endpointAt(endpoints.get(answer.service) ?? [], route.path) : undefined;
      if (!('service' in answer) || endpoint === undefined) {
        const why =
          'why' in answer
            ? answer.why
            : `${answer.service} serves no GraphQL endpoint at ${route.path === '' ? 'the address' : pathOf(route.path)}${(endpoints.get(answer.service) ?? []).length === 0 ? '' : ` (it serves ${(endpoints.get(answer.service) ?? []).map((each) => String(each.meta?.['path'] ?? '?')).join(', ')})`}`;
        rows.push({
          service: gateway.repo,
          file: route.file,
          line: route.line,
          reason: 'graphql-subgraph-not-joined',
          level: 'action',
          message: `${gateway.repo} sends the subgraph ${route.name} to ${route.url ?? (route.baseUrlEnv === undefined ? (route.unread ?? 'an address not written') : `${route.baseUrlEnv}${route.path}`)}, and ${why}; the fields it resolves are not joined`,
          hint: route.baseUrlEnv !== undefined
            ? `Add ${route.baseUrlEnv} to services[].baseUrlEnv of the service that is the subgraph ${route.name}, or add that service to the project.`
            : `Add ${route.host ?? 'the host'} to services[].hosts of the service that is the subgraph ${route.name}, or add that service to the project.`,
          symbol: gateway.id,
        });
        // A schema the gateway's own files hold still composes; one only the subgraph's source says does not.
        if (route.schema !== undefined) schemas.push({ name: route.name, schema: route.schema });
        else partial = true;
        continue;
      }
      const confidence = weakest(answer.confidence, read);
      routes.set(route.name, { service: answer.service, endpoint, confidence });
      routed.add(endpoint.id);
      const edge: GraphEdge = {
        from: gateway.id,
        to: endpoint.id,
        type: 'http_calls',
        confidence,
        file: route.file,
        line: route.line,
        meta: { [GRAPHQL_META]: { subgraph: route.name }, targetService: answer.service },
      };
      edges.set(edgeKey(edge), edge);
      const schema = route.schema ?? servedOf(endpoint)?.schema;
      if (schema !== undefined) schemas.push({ name: route.name, schema });
      else partial = true;
    }

    let composition = meta.composition;
    let confidence = meta.taken === true ? weakest(read, 'heuristic') : read;
    const site = { service: gateway.repo, file: gateway.file ?? '', line: gateway.line ?? 1, symbol: gateway.id };
    const conflicts: CompositionConflict[] = [];
    if (composition === undefined) {
      const composed = composeSubgraphs(schemas);
      composition = composed.composition;
      conflicts.push(...composed.conflicts);
      // A subgraph not read could own, share or override any field (D3).
      if (partial) confidence = weakest(confidence, 'heuristic');
    } else {
      for (const [name, route] of routes) {
        const schema = servedOf(route.endpoint)?.schema;
        if (schema === undefined) continue;
        for (const drift of driftOf(composition, name, schema)) {
          rows.push({
            ...site,
            ...(meta.from === undefined ? {} : { file: meta.from, line: drift.line ?? 1 }),
            reason: 'graphql-supergraph-drift',
            level: 'action',
            message:
              drift.missing === 'source'
                ? `the supergraph says ${name} resolves ${drift.field}, which ${name}'s schema does not declare; the router plans by the supergraph, so it sends ${name} a request it refuses`
                : `${name} declares ${drift.field}, which the supergraph does not have; the router serves the supergraph, so nobody can ask for it through ${gateway.repo}`,
            hint: 'Compose the supergraph again from the subgraphs as they are now (rover supergraph compose), and commit it.',
          });
        }
      }
    }
    conflicts.push(...unreachableOwners(composition));
    for (const conflict of conflicts) {
      rows.push({
        ...site,
        reason: 'graphql-composition-conflict',
        level: 'action',
        message: `${conflictSentence(conflict)}`,
        hint: conflictHint(conflict),
      });
    }
    // The router checks its authorization directives; an Apollo Gateway in code does not (P245).
    if (declared) guardFields(nodes, edges, gateway, meta, composition, routes, confidence);
    else {
      const guarded = guardedFields(composition);
      if (guarded.length > 0) {
        const shown = guarded.slice(0, 4).join(', ');
        rows.push({
          ...site,
          reason: 'graphql-auth-not-checked',
          level: 'action',
          message: `${gateway.repo} composes ${guarded.length === 1 ? 'a field' : `${guarded.length} fields`} the router's authorization directives guard (${shown}${guarded.length > 4 ? `, and ${guarded.length - 4} more` : ''}), and ${gateway.repo} is an Apollo Gateway, which does not check them: a request through it reaches ${guarded.length === 1 ? 'it' : 'them'} unchecked`,
          hint: 'Serve the graph with a router that checks the directives, or check who is asking in the subgraph\'s resolvers; on a gateway the directive alone guards nothing.',
          meta: { fields: guarded },
        });
      }
    }
    // The contract compares a selection through the gateway with what the composition has (D8).
    gateway.meta = { ...gateway.meta, [GRAPHQL_META]: { ...servedOf(gateway), schema: apiSchemaOf(composition) } };
    plans.set(gateway.id, { gateway, composition, confidence, routes });
  }

  // A subgraph nothing routes to is reached through a plan nobody here can read (D9).
  for (const list of endpoints.values()) {
    for (const endpoint of list) {
      const subgraph = servedOf(endpoint)?.subgraph;
      if (subgraph === undefined || routed.has(endpoint.id)) continue;
      rows.push({
        service: endpoint.repo,
        file: endpoint.file ?? '',
        line: endpoint.line ?? 0,
        reason: 'graphql-federation-not-read',
        level: 'info',
        message: `${endpoint.repo} is one subgraph of a federated graph, and no gateway or router in the project names it; its own fields are joined for a request made to it, and a request through the router is not planned into it`,
        hint: 'Add the gateway or router that serves this subgraph to the project: a repository, or its supergraph as a document ({ "document": { "kind": "graphql", "path": "supergraph.graphql" } }).',
        symbol: endpoint.id,
        meta: { detail: 'no-gateway' },
      });
    }
  }
  return { plans, rows };
};
