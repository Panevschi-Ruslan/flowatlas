import { CONFIDENCE_RANK, type Confidence, type GraphEdge, type GraphNode, type Unresolved } from '@flowatlas/core';
import {
  apiSchemaOf,
  composeSubgraphs,
  GRAPHQL_META,
  unreachableOwners,
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
 * 3. **Subgraphs no gateway names**, said once each.
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
      if (!composed.owners.some((owner) => owner.subgraph === subgraph)) continue;
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
    : `${conflict.subgraphs[0] ?? '?'} resolves ${conflict.type}.${conflict.field} but declares no key ${conflict.type} can be fetched by there, so an entity call from another subgraph cannot reach it`;

export const routeGateways = (
  nodes: ReadonlyMap<string, GraphNode>,
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
        hint:
          conflict.kind === 'shared'
            ? `Mark ${conflict.type}.${conflict.field} @shareable in every subgraph that resolves it, or move it to one of them with @override(from:).`
            : `Declare @key on ${conflict.type} in ${conflict.subgraphs[0] ?? 'the subgraph'}, or move the field to a subgraph that does.`,
      });
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
