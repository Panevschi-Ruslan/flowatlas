import { makeEntryId, type Confidence, type GraphEdge, type GraphNode, type Unresolved } from '@flowatlas/core';
import { GRAPHQL_META, namedTypeIn, planSelection, REFERENCE_FIELD, type GatewayMeta, type GraphqlCallMeta, type SchemaSummary } from '@flowatlas/graphql';
import { weakest, type GatewayPlan } from './graphql-federation.js';
import { edgeKey } from './order.js';

/**
 * The fields a GraphQL request selects, joined to the resolvers of the
 * service it reached (P232).
 *
 * By the time this runs every request has been joined to a route by its
 * address, as any request is; a request to a GraphQL server joined that
 * server's endpoint. Here each field it selects becomes an edge of the same
 * kind and confidence to that service's entry for the field - the root
 * fields, and every field below them a resolver of its own answers, found by
 * walking down from the root type through the schema the endpoint carries.
 * A field is only ever looked for in the service the request reached (D3),
 * so two services with a `Query.orders` each are never confused, and nothing
 * is joined by an operation's name.
 *
 * A request to a federation gateway is planned instead (P241): each field
 * goes to the subgraph the composition gives it to, through the routes the
 * gateway's plan holds (`routeGateways`), with an entity hop to the owner's
 * reference resolver where the field lives in another subgraph than its
 * parent.
 */
export const joinGraphqlFields = (nodes: ReadonlyMap<string, GraphNode>, edges: Map<string, GraphEdge>, plans: ReadonlyMap<string, GatewayPlan> = new Map()): Unresolved[] => {
  const rows: Unresolved[] = [];
  for (const edge of [...edges.values()]) {
    if (edge.type !== 'hits' && edge.type !== 'http_calls') continue;
    const call = nodes.get(edge.from);
    const endpoint = nodes.get(edge.to);
    const operation = call?.meta?.[GRAPHQL_META] as GraphqlCallMeta | undefined;
    const served = endpoint?.meta?.[GRAPHQL_META] as { endpoint?: boolean; schema?: SchemaSummary; gateway?: GatewayMeta } | undefined;
    // A gateway's own route to a subgraph carries no operation.
    if (call === undefined || endpoint === undefined || operation === undefined || !Array.isArray(operation.fields) || served?.endpoint !== true) continue;
    const plan = plans.get(endpoint.id);
    if (plan !== undefined) {
      rows.push(...joinPlanned(nodes, edges, edge, call, operation, plan));
      continue;
    }
    // A gateway whose composition could not be read has nothing to plan with; its row says why.
    if (served.gateway !== undefined) continue;
    const schema = served.schema;
    const service = endpoint.repo;
    const rootType = schema?.roots[operation.operation] ?? (operation.operation === 'query' ? 'Query' : operation.operation === 'mutation' ? 'Mutation' : 'Subscription');
    const named = operation.name ?? operation.operation;

    const join = (type: string, field: GraphqlCallMeta['fields'][number], depth: number): void => {
      if (depth > 32 || field.field === '__typename') return;
      const owner = field.on ?? type;
      const entryId = makeEntryId(service, 'graphql', `${owner}.${field.field}`);
      const entry = nodes.get(entryId);
      const declared = schema?.types[owner]?.fields?.[field.field];
      if (entry !== undefined) {
        const joined: GraphEdge = {
          from: call.id,
          to: entryId,
          type: edge.type,
          confidence: edge.confidence,
          ...(call.file === undefined ? {} : { file: field.file ?? operation.document.file }),
          line: field.line,
          meta: { [GRAPHQL_META]: { operation: named, field: `${owner}.${field.field}`, ...(field.alias === undefined ? {} : { alias: field.alias }) } },
        };
        edges.set(edgeKey(joined), joined);
      } else if (depth === 0 && (declared !== undefined || schema === undefined)) {
        // A root field the schema has and no resolver answers. One the schema
        // does not have is the contract's to say (`graphql-field-unknown`).
        rows.push({
          service: call.repo,
          file: field.file ?? operation.document.file,
          line: field.line,
          reason: 'graphql-field-no-resolver',
          level: 'action',
          message: `${named} asks ${service} for ${owner}.${field.field}, which no resolver of ${service} answers`,
          hint: 'Resolve the field in the service, or correct the operation; the request stops at the endpoint.',
          symbol: call.id,
        });
      }
      if (declared === undefined || field.selections === undefined) return;
      for (const inner of field.selections) join(namedTypeIn(declared.type), inner, depth + 1);
    };

    for (const field of operation.fields) join(rootType, field, 0);
  }
  return rows;
};

/**
 * A request to a gateway, planned across its subgraphs (P241): an edge of the
 * request's own type from the request to each subgraph entry a step reaches -
 * the field's resolver, and the reference resolver of an entity the router
 * fetches from another subgraph - each no surer than the request's join, the
 * route to the subgraph and the composition, and `heuristic` where the router
 * chooses (D6).
 */
const joinPlanned = (
  nodes: ReadonlyMap<string, GraphNode>,
  edges: Map<string, GraphEdge>,
  edge: GraphEdge,
  call: GraphNode,
  operation: GraphqlCallMeta,
  plan: GatewayPlan,
): Unresolved[] => {
  const rows: Unresolved[] = [];
  const named = operation.name ?? operation.operation;
  const gateway = plan.gateway.repo;
  const said = new Set<string>();
  const draw = (to: string, confidence: Confidence, line: number, file: string, graphql: Record<string, unknown>): void => {
    const joined: GraphEdge = { from: call.id, to, type: edge.type, confidence, ...(call.file === undefined ? {} : { file }), line, meta: { [GRAPHQL_META]: graphql } };
    // The first selection that reaches an entry is the one the edge names.
    if (!edges.has(edgeKey(joined))) edges.set(edgeKey(joined), joined);
  };
  const rootTypes = new Set(Object.values(plan.composition.roots));
  for (const step of planSelection(plan.composition, operation.operation, operation.fields)) {
    const field = `${step.type}.${step.field}`;
    const file = step.selected.file ?? operation.document.file;
    const line = step.selected.line;
    const choice = step.subgraphs.length > 1;
    if (choice && !step.underChoice && !said.has(field)) {
      said.add(field);
      rows.push({
        service: call.repo,
        file,
        line,
        reason: 'graphql-shareable-choice',
        level: 'info',
        message: `${named} selects ${field} through ${gateway}, which ${step.subgraphs.join(' and ')} each resolve; the router chooses one at run time, so each is drawn as a choice`,
        hint: 'Nothing is wrong. Which subgraph answers is the router\'s plan, decided by cost when the request arrives; both edges are heuristic for that reason.',
        symbol: call.id,
      });
    }
    for (const subgraph of step.subgraphs) {
      const route = plan.routes.get(subgraph);
      // A subgraph not joined has a row of its own at the gateway.
      if (route === undefined) continue;
      const confidence = weakest(edge.confidence, route.confidence, plan.confidence, choice || step.underChoice === true ? 'heuristic' : 'static');
      const graphql = {
        operation: named,
        gateway,
        subgraph,
        ...(choice ? { choice: step.subgraphs } : {}),
        ...(step.requiredBy === undefined ? {} : { requiredBy: step.requiredBy }),
      };
      if (step.hop !== undefined) {
        const reference = makeEntryId(route.service, 'graphql', `${step.hop.entity}.${REFERENCE_FIELD}`);
        if (nodes.has(reference)) draw(reference, confidence, line, file, { ...graphql, field: `${step.hop.entity}.${REFERENCE_FIELD}`, hop: { entity: step.hop.entity, from: step.hop.from, for: field } });
      }
      const entryId = makeEntryId(route.service, 'graphql', field);
      if (nodes.has(entryId)) {
        draw(entryId, confidence, line, file, { ...graphql, field, ...(step.selected.alias === undefined ? {} : { alias: step.selected.alias }), ...(step.hop === undefined ? {} : { hop: { entity: step.hop.entity, from: step.hop.from } }) });
      } else if (rootTypes.has(step.type) && step.hop === undefined && step.requiredBy === undefined && !said.has(`${field} ${subgraph}`)) {
        said.add(`${field} ${subgraph}`);
        rows.push({
          service: call.repo,
          file,
          line,
          reason: 'graphql-field-no-resolver',
          level: 'action',
          message: `${named} asks ${gateway} for ${field}, which the composition gives to ${subgraph} (${route.service}), and no resolver of ${route.service} answers it`,
          hint: 'Resolve the field in the subgraph, or correct the operation; the request stops at the gateway.',
          symbol: call.id,
        });
      }
    }
  }
  return rows;
};
