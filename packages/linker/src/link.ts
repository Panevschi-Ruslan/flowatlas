import { createHash } from 'node:crypto';
import {
  namesGivenTo,
  SCHEMA_VERSION,
  wasMissed,
  type FlowatlasConfig,
  type GraphEdge,
  type GraphNode,
  type ProjectGraph,
  type RecordedMarker,
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
import { auditRoutes } from './route-audit.js';
import { answeredOnlyByWildcard } from './route-match.js';
import { cmp, edgeKey } from './order.js';
import type { LinkReport, ServiceReport } from './report.js';
import { surveyChannels, surveyRoutes } from './survey.js';
import {
  callPerChoice,
  missingChoiceFinding,
  resolveUiCall,
  uiFindingFor,
  uiReasonOf,
  type UiIndex,
  type UiOutcome,
} from './ui-link.js';

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

/**
 * Reads every annotation that says where a call goes, in the order written.
 *
 * The service is the first argument and every argument after it is a route, or
 * a list of them: a method that reaches three routes of one service says so in
 * one annotation or in three, and both have to mean the same thing (R38).
 * An argument that names no route is left to `doctor`, which is where an
 * annotation is held to account; dropping it here without a word is what made
 * the shorter form fail in silence.
 */
const callsServicesOf = (method: GraphNode | undefined): CallsServiceMarker[] => {
  const markers = method?.meta?.['markers'] as RecordedMarker[] | undefined;
  const found: CallsServiceMarker[] = [];
  for (const marker of markers ?? []) {
    if (marker.name !== 'CallsService') continue;
    const [service] = marker.args;
    if (typeof service !== 'string') continue;
    for (const route of namesGivenTo(marker).names) {
      const [verb, path] = route.trim().split(/\s+/);
      if (verb === undefined || path === undefined) continue;
      found.push({ service, method: verb.toUpperCase(), path });
    }
  }
  return found;
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
    markerOf: (callId) => callsServicesOf(nodes.get(callerOf.get(callId) ?? ''))[0],
    markersOf: (callId) => callsServicesOf(nodes.get(callerOf.get(callId) ?? '')),
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

/** A call whose address as written reaches nothing, or nothing but a catch-all. */
type Spread =
  | { kind: 'all'; linked: Array<{ path: string; outcome: Extract<UiOutcome, { kind: 'linked' }> }> }
  | {
      kind: 'some';
      linked: Array<{ path: string; outcome: Extract<UiOutcome, { kind: 'linked' }> }>;
      missing: string[];
    }
  | undefined;

/** What is said about a request only a catch-all answers. */
const wildcardFinding = (call: GraphNode, entry: GraphNode): Finding => {
  const asked = `${String(call.meta?.['method'] ?? '?')} ${String(call.meta?.['path'] ?? '?')}`;
  const route = `${String(entry.meta?.['method'] ?? '?')} ${String(entry.meta?.['path'] ?? '?')}`;
  return {
    reason: 'route-wildcard-only',
    message: `only the catch-all ${route} in ${entry.repo} answers ${asked}`,
    hint: `No route of ${entry.repo} spells this out, so whatever sits behind the catch-all is unlikely to serve it. Check for a renamed or missing route.`,
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

    const { outcome, notes, alsoLinked } = resolveCall(call, index);
    for (const note of notes) record(call, note);

    if (outcome.kind === 'linked') {
      const edge = callEdge(call, outcome);
      edges.set(edgeKey(edge), edge);
      for (const entry of alsoLinked ?? []) {
        const more = callEdge(call, { ...outcome, entry, runnersUp: [] });
        edges.set(edgeKey(more), more);
      }
      httpOut.linked += 1;
      if (outcome.via === 'marker') httpOut.byMarker += 1;
      const routes = routesByService.get(outcome.entry.repo) ?? [];
      if (answeredOnlyByWildcard(outcome.entry, routes)) record(call, wildcardFinding(call, outcome.entry));
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

    /** True when matching the address as written settled nothing worth keeping. */
    const onlyCatchAll = (found: UiOutcome): boolean =>
      found.kind !== 'linked' ||
      answeredOnlyByWildcard(found.entry, routesByService.get(found.targetService) ?? []);

    /**
     * The call resolved once per value its closed segment can take.
     *
     * Asked only where the plain reading landed on a catch-all or on nothing,
     * so a call that already joined cleanly is never turned into several.
     */
    const spread = (node: GraphNode): Spread => {
      const copies = callPerChoice(node);
      if (copies === undefined) return undefined;
      const asked = copies.map((copy) => ({
        path: String(copy.meta?.['path'] ?? '?'),
        outcome: resolveUiCall(copy, uiIndex),
      }));
      const linked = asked
        .filter((each) => each.outcome.kind === 'linked')
        .map((each) => ({
          path: each.path,
          outcome: each.outcome as Extract<UiOutcome, { kind: 'linked' }>,
        }))
        .filter((each) => !onlyCatchAll(each.outcome));
      if (linked.length === 0) return undefined;
      if (linked.length === asked.length) return { kind: 'all', linked };
      // Only the values that reached nothing at all are missing. One that
      // reached a catch-all did reach a route, and saying it "reaches no
      // route" would be false; it keeps the wildcard finding it already had.
      const missing = asked
        .filter((each) => each.outcome.kind !== 'linked')
        .map((each) => each.path);
      if (missing.length === 0) return { kind: 'all', linked };
      return { kind: 'some', linked, missing };
    };

    const outcome = resolveUiCall(call, uiIndex);
    const spelledOut = onlyCatchAll(outcome) ? spread(call) : undefined;

    // Every value a closed segment can take reaches a route of its own, and
    // matching the segment as a hole reached a catch-all or nothing. The
    // addresses somebody wrote are the better answer (R31).
    if (spelledOut?.kind === 'all') {
      for (const each of spelledOut.linked) {
        const edge = uiEdge(call, each.outcome);
        edges.set(edgeKey(edge), edge);
        call.meta = { ...call.meta, targetService: each.outcome.targetService };
      }
      ui.resolved += 1;
      continue;
    }

    if (outcome.kind === 'linked' && spelledOut?.kind !== 'some') {
      const edge = uiEdge(call, outcome);
      edges.set(edgeKey(edge), edge);
      ui.resolved += 1;
      const routes = routesByService.get(outcome.targetService) ?? [];
      if (answeredOnlyByWildcard(outcome.entry, routes)) record(call, wildcardFinding(call, outcome.entry));
      call.meta = { ...call.meta, targetService: outcome.targetService };
      continue;
    }

    // Some of the values reach a route and some do not, which is a better
    // finding than the one the whole call would have got: it names the value
    // nothing serves, which is what a renamed handler looks like from here.
    if (spelledOut?.kind === 'some') {
      // The values that did reach a route are edges, whether or not the others
      // did. They were resolved; throwing them away would leave the graph
      // missing something the tool had already worked out.
      for (const each of spelledOut.linked) {
        const edge = uiEdge(call, each.outcome);
        edges.set(edgeKey(edge), edge);
        call.meta = { ...call.meta, targetService: each.outcome.targetService };
      }
      ui.unresolved += 1;
      const finding = missingChoiceFinding(
        String(call.meta?.['method'] ?? '?'),
        spelledOut.missing,
        spelledOut.linked.map((each) => each.path),
      );
      ui.byReason[finding.reason] = (ui.byReason[finding.reason] ?? 0) + 1;
      record(call, finding);
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

  found.push(
    ...auditRoutes(nodes, edges.values(), {
      publicDecorators: config.doctor.publicDecorators,
      publicRoutes: config.doctor.publicRoutes,
      nonGateWrappers: config.doctor.nonGateWrappers,
      skipGuardDecorators: config.doctor.skipGuardDecorators,
    }),
  );

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
      unresolved: project.unresolved.filter(wasMissed).length,
    },
  };

  return { project, report };
};

export { configHashOf };
export type { TypeEntry };
