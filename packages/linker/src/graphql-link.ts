import { makeEntryId, type Confidence, type GraphEdge, type GraphNode, type Unresolved } from '@flowatlas/core';
import { GRAPHQL_META, namedTypeIn, planSelection, REFERENCE_FIELD, type GatewayMeta, type GraphqlCallMeta, type PlanStep, type SchemaSummary } from '@flowatlas/graphql';
import { authOfField, weakest, type GatewayPlan } from './graphql-federation.js';
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
 * parent - for an interface object's field, or a type the subgraph fetching
 * the parent cannot tell, the interface's (P245).
 */
export const joinGraphqlFields = (nodes: ReadonlyMap<string, GraphNode>, edges: Map<string, GraphEdge>, plans: ReadonlyMap<string, GatewayPlan> = new Map()): Unresolved[] => {
  const rows: Unresolved[] = [];
  for (const edge of [...edges.values()]) {
    if (edge.type !== 'hits' && edge.type !== 'http_calls') continue;
    const call = nodes.get(edge.from);
    const endpoint = nodes.get(edge.to);
    const operation = call?.meta?.[GRAPHQL_META] as GraphqlCallMeta | undefined;
    const served = endpoint?.meta?.[GRAPHQL_META] as { endpoint?: boolean; schema?: SchemaSummary; gateway?: GatewayMeta; fieldsAt?: string; open?: string } | undefined;
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
    // A server that serves several schemas keys each one's fields by its path (P266).
    const keyed = served.fieldsAt === undefined ? '' : `@${served.fieldsAt}`;

    const join = (type: string, field: GraphqlCallMeta['fields'][number], depth: number): void => {
      if (depth > 32 || field.field === '__typename') return;
      const owner = field.on ?? type;
      const entryId = makeEntryId(service, 'graphql', `${owner}.${field.field}${keyed}`);
      const own = nodes.get(entryId) === undefined && keyed !== '' ? makeEntryId(service, 'graphql', `${owner}.${field.field}`) : entryId;
      // A field resolver below the root is any schema's of the server: its type is shared.
      const entry = nodes.get(entryId) ?? (depth > 0 ? nodes.get(own) : undefined);
      const declared = schema?.types[owner]?.fields?.[field.field];
      if (entry !== undefined) {
        const joined: GraphEdge = {
          from: call.id,
          to: entry.id,
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
      } else if (depth === 0 && served.open !== undefined) {
        // A field the schema read does not have, at a server that answers
        // some requests itself (P266): said, not called unknown.
        rows.push({
          service: call.repo,
          file: field.file ?? operation.document.file,
          line: field.line,
          reason: 'graphql-field-no-resolver',
          level: 'info',
          message: `${named} asks ${service} at ${String(endpoint.meta?.['path'] ?? '')} for ${owner}.${field.field}, which no resolver of ${service} declares; ${served.open}, which may answer it`,
          hint: 'Resolve the field in the service if it is meant to be one, or correct the operation; a field only the server\'s own code answers is not read.',
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

/** Whether a plan edge is a fetch the router makes for a `@requires`, not the client's selection (P256). */
const isRequiredFetch = (edge: GraphEdge): boolean => {
  const graphql = edge.meta?.[GRAPHQL_META];
  return graphql !== null && typeof graphql === 'object' && typeof (graphql as Record<string, unknown>)['requiredBy'] === 'string';
};

/**
 * A request to a gateway, planned across its subgraphs (P241): an edge of the
 * request's own type from the request to each subgraph entry a step reaches -
 * the field's resolver, and the reference resolver of an entity the router
 * fetches from another subgraph - each no surer than the request's join, the
 * route to the subgraph and the composition, and `heuristic` where the router
 * chooses (D6).
 *
 * Through a router that checks its authorization directives (P252), the edge
 * to an entry that answers a guarded field with no resolver of its own says
 * so (`answers`), so the check hung on that entry for the field is shown on
 * this step; an entity call its owner cannot type says `hop.untyped`.
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
    // `through`: the service the request comes through, whose own checks are in front of the step (P245).
    const joined: GraphEdge = { from: call.id, to, type: edge.type, confidence, ...(call.file === undefined ? {} : { file }), line, meta: { [GRAPHQL_META]: graphql, through: gateway } };
    // The first selection that reaches an entry is the one the edge names;
    // the client's own selection over a fetch the router makes for a
    // `@requires`, which is planned first and is not checked (P256).
    const held = edges.get(edgeKey(joined));
    if (held === undefined || (isRequiredFetch(held) && graphql['requiredBy'] === undefined)) edges.set(edgeKey(joined), joined);
  };
  const rootTypes = new Set(Object.values(plan.composition.roots));
  const steps = planSelection(plan.composition, operation.operation, operation.fields, plan.saysType === undefined ? {} : { saysType: plan.saysType });
  /** The entry a subgraph's step is answered by: its own resolver, under the type it resolves it as. */
  const entryOf = (step: PlanStep, service: string, subgraph: string): string => makeEntryId(service, 'graphql', `${step.as?.[subgraph] ?? step.type}.${step.field}`);
  /**
   * The entry that answers a field with no resolver of its own (P252): the
   * reference resolver of the entity call that fetched it, or the nearest
   * resolver above it, in the same subgraph.
   */
  const answererOf = (step: PlanStep, service: string, subgraph: string): string | undefined => {
    const referenceOf = (hop: NonNullable<PlanStep['hop']>): string | undefined => {
      const reference = makeEntryId(service, 'graphql', `${hop.entity}.${REFERENCE_FIELD}`);
      return nodes.has(reference) ? reference : undefined;
    };
    if (step.hop !== undefined) return referenceOf(step.hop);
    let below = step;
    for (let depth = 0; below.parent !== undefined && depth < steps.length; depth += 1) {
      const above = steps[below.parent] as PlanStep;
      if (!above.subgraphs.includes(subgraph)) return undefined;
      if (nodes.has(entryOf(above, service, subgraph))) return entryOf(above, service, subgraph);
      if (above.hop !== undefined) return referenceOf(above.hop);
      below = above;
    }
    return undefined;
  };
  /** The guarded fields each entry answers for this request with no resolver of their own, which its checks for them stand in front of (P252). */
  const answers = new Map<string, Set<string>>();
  for (const step of steps) {
    const field = `${step.type}.${step.field}`;
    const file = step.selected.file ?? operation.document.file;
    const line = step.selected.line;
    const choice = step.subgraphs.length > 1;
    // An argument the router fills from a context nothing above the field sets on this path (P245).
    for (const unset of step.unset ?? []) {
      if (said.has(`${field}(${unset.argument})`)) continue;
      said.add(`${field}(${unset.argument})`);
      rows.push({
        service: call.repo,
        file,
        line,
        reason: 'graphql-context-not-reached',
        level: 'info',
        message: `${named} selects ${field}, whose argument ${unset.argument} the router fills from the context ${unset.context}, and no type above it in this selection sets ${unset.context}; what the argument needs is not planned`,
        hint: `Select ${field} under a field that returns the type with @context(name: "${unset.context}"), or pass the argument some other way; the router fills it only from an ancestor that sets the context.`,
        symbol: call.id,
        meta: { field, argument: unset.argument, context: unset.context },
      });
    }
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
        ...(step.fromContext === undefined ? {} : { fromContext: step.fromContext }),
      };
      // An entity call for an interface its owner cannot say the type of is refused there (P252).
      const untyped = step.hop?.untyped === true ? { untyped: true } : {};
      if (step.hop !== undefined) {
        const reference = makeEntryId(route.service, 'graphql', `${step.hop.entity}.${REFERENCE_FIELD}`);
        if (nodes.has(reference)) draw(reference, confidence, line, file, { ...graphql, field: `${step.hop.entity}.${REFERENCE_FIELD}`, hop: { entity: step.hop.entity, from: step.hop.from, for: field } });
      }
      // An interface object resolves an implementation's field as the interface's (P245).
      const resolvedAs = step.as?.[subgraph];
      const entryId = entryOf(step, route.service, subgraph);
      if (nodes.has(entryId)) {
        draw(entryId, confidence, line, file, {
          ...graphql,
          field,
          ...(resolvedAs === undefined ? {} : { as: resolvedAs }),
          ...(step.selected.alias === undefined ? {} : { alias: step.selected.alias }),
          ...(step.hop === undefined ? {} : { hop: { entity: step.hop.entity, from: step.hop.from, ...untyped } }),
        });
      } else if (
        plan.checks === true &&
        // The router checks the client's selection; a field it fetches for a `@requires` is not checked (P256).
        step.requiredBy === undefined &&
        !rootTypes.has(step.type) &&
        step.field !== '__typename' &&
        authOfField(plan.composition, step.type, step.field).length > 0
      ) {
        // A guarded field no resolver of its own answers: the check is in front of the entry that does, for it (P252).
        const answerer = answererOf(step, route.service, subgraph);
        if (answerer !== undefined) answers.set(answerer, (answers.get(answerer) ?? new Set()).add(`${resolvedAs ?? step.type}.${step.field}`));
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
  // `answers`: the step to an entry carries the guarded fields it answers here, so its checks for them are shown on it (P252).
  for (const [to, fields] of answers) {
    const key = edgeKey({ from: call.id, to, type: edge.type, confidence: edge.confidence });
    const joined = edges.get(key);
    if (joined !== undefined) edges.set(key, { ...joined, meta: { ...joined.meta, answers: [...fields].sort() } });
  }
  return rows;
};
