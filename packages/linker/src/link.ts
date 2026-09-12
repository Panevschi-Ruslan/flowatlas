import { createHash } from 'node:crypto';
import {
  SCHEMA_VERSION,
  type FlowatlasConfig,
  type GraphEdge,
  type GraphNode,
  type ProjectGraph,
  type RepoGraph,
  type ServiceSummary,
  type TypeEntry,
  type Unresolved,
} from '@flowatlas/core';
import {
  findingFor,
  resolveCall,
  type CallOutcome,
  type CallsServiceMarker,
  type Finding,
  type RouteIndex,
} from './http-link.js';
import { mergeGraphs } from './merge.js';
import { cmp, edgeKey } from './order.js';
import type { LinkReport, ServiceReport } from './report.js';
import { surveyChannels, surveyRoutes } from './survey.js';
import { resolveUiCall, uiFindingFor, uiReasonOf, type UiIndex, type UiOutcome } from './ui-link.js';

export interface LinkResult {
  project: ProjectGraph;
  report: LinkReport;
}

export interface LinkOptions {
  /** Fixed timestamp, for reproducible output. */
  builtAt?: string;
  /** What happened while reading each repository, including any that were not. */
  services?: readonly ServiceReport[];
}

const configHashOf = (config: FlowatlasConfig): string =>
  createHash('sha1')
    .update(
      JSON.stringify({
        services: config.services.map((s) => ({
          name: s.name,
          repo: s.repo,
          type: s.type,
          baseUrlEnv: s.baseUrlEnv ?? [],
          apiBaseEnv: s.apiBaseEnv ?? [],
        })),
        sharedPackages: [...config.sharedPackages].sort(),
      }),
    )
    .digest('hex')
    .slice(0, 12);

/** Reads the annotation that says where a call goes, if the method carries one. */
const callsServiceOf = (method: GraphNode | undefined): CallsServiceMarker | undefined => {
  const markers = method?.meta?.['markers'] as Array<{ name: string; args: unknown[] }> | undefined;
  const marker = markers?.find((item) => item.name === 'CallsService');
  const [service, route] = marker?.args ?? [];
  if (typeof service !== 'string' || typeof route !== 'string') return undefined;
  const [verb, path] = route.trim().split(/\s+/);
  if (verb === undefined || path === undefined) return undefined;
  return { service, method: verb.toUpperCase(), path };
};

/** Which routes each service serves, which is what both matchers ask first. */
const routesByServiceOf = (nodes: ReadonlyMap<string, GraphNode>): Map<string, GraphNode[]> => {
  const routesByService = new Map<string, GraphNode[]>();
  for (const node of nodes.values()) {
    if (node.type !== 'entry' || node.kind !== 'http') continue;
    const list = routesByService.get(node.repo);
    if (list === undefined) routesByService.set(node.repo, [node]);
    else list.push(node);
  }
  return routesByService;
};

/**
 * Which services claim each settings key as their own base.
 *
 * A key must name one service. Two services claiming it makes every call rooted
 * at it unattributable, so neither is chosen.
 */
const servicesByEnvOf = (config: FlowatlasConfig): Map<string, string[]> => {
  const servicesByEnv = new Map<string, string[]>();
  for (const service of config.services) {
    for (const env of service.baseUrlEnv ?? []) {
      const claiming = servicesByEnv.get(env);
      if (claiming === undefined) servicesByEnv.set(env, [service.name]);
      else claiming.push(service.name);
    }
  }
  return servicesByEnv;
};

/** The three lookups resolving a call needs, built once over the merged graph. */
const buildRouteIndex = (
  nodes: ReadonlyMap<string, GraphNode>,
  edges: Iterable<GraphEdge>,
  config: FlowatlasConfig,
  routesByService: ReadonlyMap<string, GraphNode[]>,
  servicesByEnv: ReadonlyMap<string, string[]>,
): RouteIndex => {
  const callerOf = new Map<string, string>();
  for (const edge of edges) {
    if (edge.type !== 'calls') continue;
    if (nodes.get(edge.to)?.type === 'http_out') callerOf.set(edge.to, edge.from);
  }

  const known = new Set(config.services.map((service) => service.name));
  return {
    routesOf: (service) =>
      known.has(service) || routesByService.has(service)
        ? (routesByService.get(service) ?? [])
        : undefined,
    claimantsOf: (env) => servicesByEnv.get(env) ?? [],
    markerOf: (callId) => callsServiceOf(nodes.get(callerOf.get(callId) ?? '')),
  };
};

/** The same lookups, for a request made in a browser. */
const buildUiIndex = (
  config: FlowatlasConfig,
  routesByService: ReadonlyMap<string, GraphNode[]>,
  servicesByEnv: ReadonlyMap<string, string[]>,
): UiIndex => {
  const targets = new Map<string, string>();
  for (const service of config.services) {
    for (const [env, target] of Object.entries(service.apiTarget ?? {})) {
      targets.set(`${service.name}\0${env}`, target);
    }
  }
  const serving = [...routesByService.keys()].sort(cmp);
  return {
    routesOf: (service) => routesByService.get(service),
    targetOf: (repo, env) => targets.get(`${repo}\0${env}`),
    claimantsOf: (env) => servicesByEnv.get(env) ?? [],
    services: () => serving,
  };
};

/** The edge a resolved call becomes. */
const callEdge = (call: GraphNode, outcome: Extract<CallOutcome, { kind: 'linked' }>): GraphEdge => {
  const params = call.meta?.['bodyType'];
  const returns = call.meta?.['responseType'];
  return {
    from: call.id,
    to: outcome.entry.id,
    type: 'http_calls',
    confidence: outcome.via === 'marker' ? 'marker' : 'static',
    ...(call.file === undefined ? {} : { file: call.file }),
    ...(call.line === undefined ? {} : { line: call.line }),
    ...(typeof params === 'string' ? { params: [params] } : {}),
    ...(typeof returns === 'string' ? { returns } : {}),
    meta: {
      via: outcome.via,
      targetService: outcome.entry.repo,
      ...(outcome.runnersUp.length === 0
        ? {}
        : {
            note: `chosen over ${outcome.runnersUp.join(', ')} for being more specific; the framework decides by registration order`,
          }),
    },
  };
};

/**
 * The edge a resolved request from a browser becomes.
 *
 * An address a person wrote in an annotation stays `marker` however the service
 * on the other end was found: what was asserted is the request itself, and an
 * edge may not claim more than the weakest thing it rests on. A guess about
 * which service serves a route is `heuristic` for the same reason (D4), and so
 * is an address the extractor read through a branch nobody settled (R11) — the
 * service may be certain and the path still be a guess.
 */
const uiEdge = (call: GraphNode, outcome: Extract<UiOutcome, { kind: 'linked' }>): GraphEdge => {
  const params = call.meta?.['bodyType'];
  const returns = call.meta?.['responseType'];
  const asserted = call.meta?.['via'] === 'marker';
  const guessed = call.meta?.['guessed'] === true || outcome.via === 'unique-route';
  return {
    from: call.id,
    to: outcome.entry.id,
    type: 'hits',
    confidence: asserted ? 'marker' : guessed ? 'heuristic' : 'static',
    ...(call.file === undefined ? {} : { file: call.file }),
    ...(call.line === undefined ? {} : { line: call.line }),
    ...(typeof params === 'string' ? { params: [params] } : {}),
    ...(typeof returns === 'string' ? { returns } : {}),
    meta: {
      via: outcome.via,
      targetService: outcome.targetService,
      ...(outcome.runnersUp.length === 0
        ? {}
        : {
            note: `chosen over ${outcome.runnersUp.join(', ')} for being more specific; the framework decides by registration order`,
          }),
    },
  };
};

/** Which service a call was aimed at, as far as it could be worked out. */
const aimOf = (outcome: CallOutcome): string | undefined => {
  if (outcome.kind === 'linked') return outcome.entry.repo;
  if (outcome.kind === 'noRoute' || outcome.kind === 'ambiguous') return outcome.targetService;
  if (outcome.kind === 'dynamic') return outcome.targetService;
  return undefined;
};

const emptyHttpOut = (): LinkReport['httpOut'] => ({
  total: 0,
  linked: 0,
  byMarker: 0,
  unknownEnv: 0,
  noRoute: 0,
  ambiguous: 0,
  external: 0,
  dynamic: 0,
});

const emptyUi = (): LinkReport['ui'] => ({ total: 0, resolved: 0, unresolved: 0, byReason: {} });

/**
 * Joins the repositories into one graph.
 *
 * Two things cross a service boundary: a call to another service's route, and a
 * message on a channel. Both are joined here and nowhere else, which is why this
 * is the step the whole tool exists for. The work itself lives in four
 * neighbours — merging, resolving one call, surveying channels and routes — and
 * what is left here is the order in which they happen.
 */
export const linkGraphs = (
  graphs: readonly RepoGraph[],
  config: FlowatlasConfig,
  options: LinkOptions = {},
): LinkResult => {
  const merged = mergeGraphs(graphs, config);
  const { nodes, edges, types } = merged;
  const found: Unresolved[] = [];
  const httpOut = emptyHttpOut();
  const ui = emptyUi();

  const routesByService = routesByServiceOf(nodes);
  const servicesByEnv = servicesByEnvOf(config);
  const index = buildRouteIndex(nodes, edges.values(), config, routesByService, servicesByEnv);
  const uiIndex = buildUiIndex(config, routesByService, servicesByEnv);

  /** Where a finding happened; the finding itself says what and what to do. */
  const record = (call: GraphNode, finding: Finding): void => {
    found.push({
      service: call.repo,
      file: call.file ?? '',
      line: call.line ?? 0,
      ...finding,
      symbol: call.id,
    });
  };

  for (const call of nodes.values()) {
    if (call.type !== 'http_out') continue;
    httpOut.total += 1;

    const { outcome, notes } = resolveCall(call, index);
    for (const note of notes) record(call, note);

    if (outcome.kind === 'linked') {
      const edge = callEdge(call, outcome);
      edges.set(edgeKey(edge), edge);
      httpOut.linked += 1;
      if (outcome.via === 'marker') httpOut.byMarker += 1;
    } else {
      httpOut[outcome.kind] += 1;
    }

    const aim = aimOf(outcome);
    if (aim !== undefined) call.meta = { ...call.meta, targetService: aim };

    const finding = findingFor(outcome);
    if (finding !== undefined) record(call, finding);
  }

  // A request made in a browser is joined the same way and counted apart: the
  // frontend is the one caller whose fix is a line of configuration.
  for (const call of nodes.values()) {
    if (call.type !== 'ui_api_call') continue;
    ui.total += 1;

    const outcome = resolveUiCall(call, uiIndex);
    if (outcome.kind === 'linked') {
      const edge = uiEdge(call, outcome);
      edges.set(edgeKey(edge), edge);
      ui.resolved += 1;
      call.meta = { ...call.meta, targetService: outcome.targetService };
      continue;
    }

    ui.unresolved += 1;
    const reason = uiReasonOf(outcome);
    if (reason !== undefined) ui.byReason[reason] = (ui.byReason[reason] ?? 0) + 1;
    // An address built at run time was already reported where it was written,
    // with the annotation that would fix it; saying it again here adds nothing.
    const finding = uiFindingFor(outcome);
    if (finding !== undefined) record(call, finding);
  }

  const channels = surveyChannels(nodes.values(), edges.values());
  const routes = surveyRoutes(nodes.values(), edges.values());

  found.push(...merged.collisions);

  const services: ServiceSummary[] = config.services.map((service) => {
    const reported = options.services?.find((item) => item.name === service.name);
    return {
      name: service.name,
      repo: service.repo,
      type: service.type,
      extractor: reported?.extractor ?? null,
      ...(reported?.skipped === undefined ? {} : { skipped: reported.skipped }),
    };
  });

  const builtAt = options.builtAt ?? new Date().toISOString();
  const project: ProjectGraph = {
    schemaVersion: SCHEMA_VERSION,
    builtAt,
    services,
    nodes: [...nodes.values()].sort((a, b) => cmp(a.id, b.id)),
    edges: [...edges.values()].sort(
      (a, b) => cmp(a.from, b.from) || cmp(a.to, b.to) || cmp(a.type, b.type),
    ),
    types: Object.fromEntries(Object.entries(types).sort((a, b) => cmp(a[0], b[0]))),
    unresolved: [...merged.unresolved, ...found].sort(
      (a, b) =>
        cmp(a.service ?? '', b.service ?? '') ||
        cmp(a.file, b.file) ||
        a.line - b.line ||
        cmp(a.reason, b.reason),
    ),
  };

  const report: LinkReport = {
    schemaVersion: SCHEMA_VERSION,
    builtAt,
    configHash: configHashOf(config),
    services: [...(options.services ?? [])].sort((a, b) => cmp(a.name, b.name)),
    httpOut,
    ui: { ...ui, byReason: Object.fromEntries(Object.entries(ui.byReason).sort((a, b) => cmp(a[0], b[0]))) },
    channels,
    routes,
    types: { total: Object.keys(types).length, sharedPackage: merged.sharedTypes },
    unresolved: found.sort(
      (a, b) => cmp(a.service ?? '', b.service ?? '') || cmp(a.file, b.file) || a.line - b.line,
    ),
    totals: {
      nodes: project.nodes.length,
      edges: project.edges.length,
      types: Object.keys(types).length,
      unresolved: project.unresolved.length,
    },
  };

  return { project, report };
};

export { configHashOf };
export type { TypeEntry };
