import { createHash } from 'node:crypto';
import {
  CONFIDENCE_RANK,
  ENVIRONMENT_META,
  namesGivenTo,
  SCHEMA_VERSION,
  serviceNamesOf,
  wasRead,
  countsOf,
  type Confidence,
  type FlowatlasConfig,
  type GraphEdge,
  type GraphNode,
  makeExternalApiId,
  type ProjectGraph,
  type RecordedMarker,
  type RepoSettings,
  type RepoGraph,
  type ServiceSummary,
  type TypeEntry,
  type Unresolved,
} from '@flowatlas/core';
import { baseUrlOf, hostIndexOf, takenMeta, whereFound, type FoundValue } from './base-url-value.js';
import {
  baseUrlTakenFinding,
  findingFor,
  mountAssumedFinding,
  resolveCall,
  type CallOutcome,
  type CallsServiceMarker,
  type Finding,
  type RouteIndex,
} from './http-link.js';
import { joinDeployments } from './deployment-link.js';
import { keepWhereDeclared } from './declared-link.js';
import { completeFromEnvironment, reachedBy } from './environment-link.js';
import { functionUrlsOf } from './function-url-link.js';
import { mergeGraphs } from './merge.js';
import {
  isProcedureEntry,
  procedureFindingFor,
  procedureReasonOf,
  resolveProcedureCall,
  type ProcedureIndex,
  type ProcedureOutcome,
} from './procedure-link.js';
import { joinChannelPatterns } from './pattern-link.js';
import { matchTakenPublishes } from './takes-link.js';
import { joinReferences } from './reference-link.js';
import { auditRoutes } from './route-audit.js';
import { answeredOnlyByWildcard, couldReach } from './route-match.js';
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
  /**
   * What each service's own files say its settings are, by service (P77):
   * read by whoever can see the files, used here to complete a base address
   * and an address waiting on the environment.
   */
  settings?: Readonly<Record<string, RepoSettings>>;
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
          // Only where there are any, so a configuration without aliases
          // keeps the fingerprint it always had (P91).
          ...((s.aliases ?? []).length === 0 ? {} : { aliases: s.aliases }),
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

  // A service answers to its aliases wherever it is named (P91).
  const names = serviceNamesOf(config);
  const named = (service: string): string => names.get(service) ?? service;
  return {
    routesOf: (service) =>
      names.has(service) || routesByService.has(service)
        ? (routesByService.get(named(service)) ?? [])
        : undefined,
    serviceOf: (service) => (names.has(service) || routesByService.has(service) ? named(service) : undefined),
    aliases: () => [...names.keys()].filter((name) => names.get(name) !== name).sort(cmp),
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
  const names = serviceNamesOf(config);
  const targets = new Map<string, string>();
  for (const service of config.services) {
    for (const [env, target] of Object.entries(service.apiTarget ?? {})) {
      // An alias is the service it names (P91).
      targets.set(`${service.name}\0${env}`, names.get(target) ?? target);
    }
  }
  const serving = [...routesByService.keys()].sort(cmp);
  return {
    routesOf: (service) => routesByService.get(names.get(service) ?? service),
    targetOf: (repo, env) => targets.get(`${repo}\0${env}`),
    claimantsOf: (env) => servicesByEnv.get(env) ?? [],
    services: () => serving,
    // A browser annotation naming its service names it the way a server one
    // does, by name or alias (P127).
    serviceOf: (service) => names.get(service) ?? (routesByService.has(service) ? service : undefined),
    aliases: () => [...names.keys()].filter((name) => names.get(name) !== name).sort(cmp),
  };
};

/**
 * The lookups a request for a procedure needs.
 *
 * Kept apart from the route index because the two are keyed by different
 * things: a route by a verb and a path pattern, a procedure by one exact string.
 * Folding them together is how a procedure path would come to be matched as a
 * URL, which it is not.
 */
const buildProcedureIndex = (
  nodes: ReadonlyMap<string, GraphNode>,
  config: FlowatlasConfig,
): ProcedureIndex => {
  const byService = new Map<string, Map<string, GraphNode>>();
  for (const node of nodes.values()) {
    if (!isProcedureEntry(node)) continue;
    const declared = byService.get(node.repo) ?? new Map<string, GraphNode>();
    declared.set(String(node.meta?.['key']), node);
    byService.set(node.repo, declared);
  }
  const names = serviceNamesOf(config);
  const targets = new Map<string, string[]>();
  for (const service of config.services) {
    targets.set(
      service.name,
      [...new Set(Object.values(service.apiTarget ?? {}).map((target) => names.get(target) ?? target))].sort(cmp),
    );
  }
  const declaring = [...byService.keys()].sort(cmp);
  const none = new Map<string, GraphNode>();
  return {
    proceduresOf: (service) => byService.get(service) ?? none,
    targetsOf: (service) => targets.get(service) ?? [],
    services: () => declaring,
  };
};

/**
 * The edge a request for a procedure becomes.
 *
 * `static` whichever of the two ways found it: the path was read in full at the
 * call and matched letter for letter, and the service was either the caller's
 * own or one the configuration named. Nothing about it was guessed.
 */
const procedureEdge = (
  call: GraphNode,
  outcome: Extract<ProcedureOutcome, { kind: 'linked' }>,
): GraphEdge => ({
  from: call.id,
  to: outcome.entry.id,
  type: 'hits',
  confidence: boundedByRoute('static', outcome.entry),
  ...(call.file === undefined ? {} : { file: call.file }),
  ...(call.line === undefined ? {} : { line: call.line }),
  meta: { via: outcome.via, targetService: outcome.targetService },
});

/**
 * A join edge may not claim more than the weakest of the two ends it rests on.
 *
 * The caller's half really was read, so on its own it is `static`. The route's
 * half may be nobody's reading at all: a service configured as a document has
 * routes that are that service's own description of itself, and there is no
 * source anywhere here to check them against. An edge that stayed `static`
 * across such a join would be saying the whole claim was proven, which is
 * precisely the overstatement the way in for a document exists not to make —
 * and it is the confidence a person actually meets, because `impact` and `flow`
 * walk these edges and print what they carry.
 *
 * `declared` is the word for exactly this and for nothing else, so the join
 * says what it is rather than borrowing the word for an annotation.
 *
 * It only ever weakens. A request whose path the extractor had to guess is
 * `heuristic` whoever answers it, and a route somebody declared does not make a
 * guess any better than it was.
 */
const boundedByRoute = (confidence: Confidence, entry: GraphNode): Confidence => {
  // Two ways a route can be weaker than the join that finds it, and the join
  // takes the weaker of what it found and what the route is. A route a document
  // declared is `declared`; a route read from an application recognised only by
  // what the source states, because its type was not installed, carries its own
  // `meta.confidence` (R142). Read through `Object.hasOwn` because the value
  // came out of a graph and the ladder is a plain object (R130).
  const own = entry.meta?.['confidence'];
  const ceilings: Confidence[] = [];
  if (typeof own === 'string' && Object.hasOwn(CONFIDENCE_RANK, own)) ceilings.push(own as Confidence);
  if (entry.meta?.['declaredBy'] !== undefined) ceilings.push('declared');
  return ceilings.reduce(
    (bound, ceiling) => (CONFIDENCE_RANK[ceiling] < CONFIDENCE_RANK[bound] ? ceiling : bound),
    confidence,
  );
};

/**
 * A join across a mount taken as empty is no stronger than a guess (R144).
 *
 * The route's address was not read in full: its leading part is where the
 * deployment mounts the service, taken as empty because every committed
 * environment file leaves it so. That is evidence, and it is not the address, so
 * the edge says `heuristic` however it was found — the word for a join resting
 * on a judgement rather than on text read letter for letter.
 */
const boundedByMount = (confidence: Confidence, mountAssumed: readonly string[] | undefined): Confidence =>
  mountAssumed === undefined || CONFIDENCE_RANK[confidence] <= CONFIDENCE_RANK.heuristic
    ? confidence
    : 'heuristic';

/** What an edge across a mount taken as empty carries, so a reader of the edge alone can see it. */
const mountMeta = (mountAssumed: readonly string[] | undefined): Record<string, unknown> =>
  mountAssumed === undefined ? {} : { mountAssumedEmpty: [...mountAssumed] };

/**
 * How far each way of joining a request is trusted. A function URL answers
 * every path, so the join is as sure as the path it was asked with (P54).
 */
const JOINED_AS: Readonly<Record<Extract<CallOutcome, { kind: 'linked' }>['via'], (call: GraphNode) => Confidence>> = {
  marker: () => 'marker',
  baseUrlEnv: () => 'static',
  // One API of several at one address, chosen by the setting's name (P59).
  apiName: () => 'heuristic',
  // The service the value a setting is given names (P77): a guess unless the
  // value is the one a function that runs the request is deployed with.
  baseUrlValue: () => 'heuristic',
  functionUrl: (call) => {
    const path = call.meta?.['path'];
    return typeof path === 'string' && wasRead(path) ? 'static' : 'heuristic';
  },
  // A worker's binding names the worker it reaches in its deployment, and the
  // path was read in full to be matched at all (P91).
  serviceBinding: () => 'static',
};

/** The edge a resolved call becomes. */
const callEdge = (call: GraphNode, outcome: Extract<CallOutcome, { kind: 'linked' }>, baseUrl?: FoundValue): GraphEdge => {
  const params = call.meta?.['bodyType'];
  const returns = call.meta?.['responseType'];
  const joinedAs = baseUrl?.deployed === true ? 'static' : JOINED_AS[outcome.via](call);
  return {
    from: call.id,
    to: outcome.entry.id,
    type: 'http_calls',
    confidence: boundedByMount(boundedByRoute(joinedAs, outcome.entry), outcome.mountAssumed),
    ...(call.file === undefined ? {} : { file: call.file }),
    ...(call.line === undefined ? {} : { line: call.line }),
    ...(typeof params === 'string' ? { params: [params] } : {}),
    ...(typeof returns === 'string' ? { returns } : {}),
    meta: {
      via: outcome.via,
      targetService: outcome.entry.repo,
      ...(outcome.via === 'functionUrl' ? { variable: call.meta?.['baseUrlEnv'] } : {}),
      ...(baseUrl === undefined ? {} : takenMeta(baseUrl)),
      ...mountMeta(outcome.mountAssumed),
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
  const guessed =
    call.meta?.['guessed'] === true ||
    outcome.via === 'unique-route' ||
    (outcome.via === 'base-url-value' && outcome.baseUrl?.deployed !== true);
  return {
    from: call.id,
    to: outcome.entry.id,
    type: 'hits',
    confidence: boundedByMount(
      boundedByRoute(asserted ? 'marker' : guessed ? 'heuristic' : 'static', outcome.entry),
      outcome.mountAssumed,
    ),
    ...(call.file === undefined ? {} : { file: call.file }),
    ...(call.line === undefined ? {} : { line: call.line }),
    ...(typeof params === 'string' ? { params: [params] } : {}),
    ...(typeof returns === 'string' ? { returns } : {}),
    meta: {
      via: outcome.via,
      targetService: outcome.targetService,
      ...mountMeta(outcome.mountAssumed),
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
  // Which program the sentence is about. A service with two applications has
  // two address spaces, and the question this row asks — does anything here
  // spell the address out? — is asked of one of them, so naming the service
  // alone would send a reader to look at routes of the other one (R132).
  const application = String(entry.meta?.['application'] ?? '');
  const where = application === '' ? entry.repo : `${entry.repo}'s ${application} application`;
  return {
    reason: 'route-wildcard-only',
    message: `only the catch-all ${route} in ${where} answers ${asked}`,
    hint: `No route of ${where} spells this out, so whatever sits behind the catch-all is unlikely to serve it. Check for a renamed or missing route.`,
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
 * The lookup a request rooted at a setting nobody claims asks of the values
 * the setting is given (P77), or nothing where the configuration turns it off.
 */
const baseUrlLookup = (
  nodes: ReadonlyMap<string, GraphNode>,
  edges: ReadonlyMap<string, GraphEdge>,
  config: FlowatlasConfig,
  settings: Readonly<Record<string, RepoSettings>>,
  byName: boolean,
): RouteIndex['baseUrlOf'] => {
  if (config.settingFiles.read === false) return undefined;
  const hosts = hostIndexOf(config, settings);
  const names = config.services.map((service) => service.name).sort(cmp);
  const functions = [...nodes.values()].filter((node) => node.type === 'entry' && node.meta?.[ENVIRONMENT_META] !== undefined);
  const runnersOf = functions.length === 0 ? new Map<string, GraphNode[]>() : reachedBy(nodes, edges, functions);
  return (call) => {
    const env = call.meta?.['baseUrlEnv'];
    if (typeof env !== 'string') return undefined;
    const variable = call.meta?.['baseUrlVariable'];
    const own = settings[call.repo];
    return baseUrlOf({
      call,
      variables: typeof variable === 'string' && variable !== env ? [env, variable] : [env],
      runners: runnersOf.get(call.id) ?? [],
      ...(own === undefined ? {} : { settings: own }),
      hosts,
      services: byName ? names : [],
    });
  };
};

/**
 * The service a request through a worker's binding reaches (P91): the workers
 * the caller's deployment binds the name to, each found among the names and
 * aliases of the configured services, or among the names a service's own
 * deployment files deploy it under.
 */
const bindingLookup = (
  config: FlowatlasConfig,
  settings: Readonly<Record<string, RepoSettings>>,
): NonNullable<RouteIndex['bindingOf']> => {
  const names = serviceNamesOf(config);
  const deployed = new Map<string, string[]>();
  for (const [service, own] of Object.entries(settings)) {
    for (const name of own.deployedAs ?? []) deployed.set(name, [...(deployed.get(name) ?? []), service]);
  }
  return (call, binding) => {
    const declared = (settings[call.repo]?.bindings ?? []).filter((each) => each.binding === binding);
    if (declared.length === 0) return { kind: 'undeclared' };
    const workers = [...new Set(declared.map((each) => each.service))].sort(cmp);
    const services = [
      ...new Set(workers.flatMap((worker) => (names.has(worker) ? [names.get(worker) as string] : (deployed.get(worker) ?? [])))),
    ].sort(cmp);
    return services.length === 1
      ? { kind: 'service', service: services[0] as string, workers }
      : { kind: 'unknown', workers, services };
  };
};

/** A request that joined nothing, the services it may be asking, and what of it was read. */
interface Unjoined {
  readonly call: GraphNode;
  /** The services it may reach; every service, where nothing named one. */
  readonly services: readonly string[] | 'any';
  readonly method: string | null;
  readonly path: string;
}

/** Whether a request's address or verb was read in part, which is what makes it a near miss. */
const partlyRead = (call: GraphNode): { method: string | null; path: string } | undefined => {
  const path = call.meta?.['path'];
  const method = call.meta?.['method'];
  if (typeof path !== 'string' || path === '') return undefined;
  const verb = typeof method === 'string' ? method : null;
  return wasRead(path) && verb !== null ? undefined : { method: verb, path };
};

/** A request between services that may still reach a route of the service it was aimed at. */
const nearMissOf = (call: GraphNode, outcome: CallOutcome): Unjoined | undefined => {
  const read = partlyRead(call);
  if (read === undefined) return undefined;
  if (outcome.kind === 'dynamic' && outcome.targetService !== undefined) return { call, services: [outcome.targetService], ...read };
  if (outcome.kind === 'unknownEnv' && outcome.claiming.length > 0) return { call, services: outcome.claiming, ...read };
  return undefined;
};

/** A browser's request that may still reach a route: of the service its key names, or of any. */
const uiNearMissOf = (call: GraphNode, index: UiIndex): Unjoined | undefined => {
  const read = partlyRead(call);
  if (read === undefined) return undefined;
  const env = call.meta?.['baseUrlEnv'];
  const named = typeof env === 'string' ? (index.targetOf(call.repo, env) ?? index.claimantsOf(env)) : [];
  const services = typeof named === 'string' ? [named] : named;
  return { call, services: services.length === 0 ? 'any' : services, ...read };
};

/**
 * The requests that could reach each route nothing calls (P91), by route id.
 *
 * Asked only of the routes nothing calls: a route something already reaches
 * is not in question. A near miss is a sentence, never an edge.
 */
const nearMissesOf = (
  uncalled: readonly string[],
  nodes: ReadonlyMap<string, GraphNode>,
  partials: readonly Unjoined[],
): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  if (partials.length === 0) return out;
  for (const id of uncalled) {
    const route = nodes.get(id);
    if (route === undefined) continue;
    const calls = partials
      .filter((partial) => partial.services === 'any' || partial.services.includes(route.repo))
      .filter((partial) => couldReach(partial.method, partial.path, route))
      .map((partial) => partial.call.id);
    if (calls.length > 0) out[id] = [...new Set(calls)].sort(cmp);
  }
  return out;
};

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
  // Before anything reads a route's address: a route hanging from another
  // repository's API only has its full path once both repositories are here.
  const found: Unresolved[] = joinDeployments(nodes, edges, merged.unresolved);
  // An address read from the environment, completed from the values each
  // function that runs it is deployed with; then every rule that takes its
  // channels by a pattern, matched against every channel, those included (P23).
  // The repository's own files fill in what a deployment leaves out (P77).
  const settings = config.settingFiles.read === false ? {} : (options.settings ?? {});
  found.push(...completeFromEnvironment(nodes, edges, merged.unresolved, settings));
  // A write onto a table's stream is a publish only where the stream is
  // declared, which only the whole project knows (P51).
  found.push(...keepWhereDeclared(nodes, edges, [merged.unresolved, found]));
  found.push(...joinChannelPatterns(nodes, edges));
  // What a consumer takes of its channel, asked of every publish onto it (P52).
  found.push(...matchTakenPublishes(nodes, edges));
  const httpOut = emptyHttpOut();
  const ui = emptyUi();
  /** Requests that joined nothing and may still reach a route (P91). */
  const partials: Unjoined[] = [];

  const routesByService = routesByServiceOf(nodes);
  const servicesByEnv = servicesByEnvOf(config);
  const urls = functionUrlsOf(nodes, edges);
  const valuedBaseUrlOf = baseUrlLookup(nodes, edges, config, settings, true);
  const valuedUiBaseUrlOf = baseUrlLookup(nodes, edges, config, settings, false);
  const index: RouteIndex = {
    ...buildRouteIndex(nodes, edges.values(), config, routesByService, servicesByEnv),
    functionUrlsOf: (callId) => urls.get(callId) ?? [],
    ...(valuedBaseUrlOf === undefined ? {} : { baseUrlOf: valuedBaseUrlOf }),
    bindingOf: bindingLookup(config, settings),
  };
  const uiIndex: UiIndex = {
    ...buildUiIndex(config, routesByService, servicesByEnv),
    ...(valuedUiBaseUrlOf === undefined ? {} : { baseUrlOf: valuedUiBaseUrlOf }),
  };
  const procedureIndex = buildProcedureIndex(nodes, config);

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

  /** One row per value taken, standing for every request it was taken for (P77). */
  const taken = new Map<string, Unresolved>();
  const tookValue = (call: GraphNode, found: FoundValue, target: string): void => {
    const key = [call.repo, found.variable, found.value, whereFound(found), target].join('\0');
    const seen = taken.get(key);
    if (seen !== undefined) {
      seen.sites = (seen.sites ?? 1) + 1;
      return;
    }
    const row: Unresolved = {
      service: call.repo,
      file: call.file ?? '',
      line: call.line ?? 0,
      ...baseUrlTakenFinding(found, target),
      symbol: call.id,
      meta: { variable: found.variable, ...(found.byName === true ? {} : { value: found.value }), from: whereFound(found) },
    };
    taken.set(key, row);
  };

  /**
   * The edge a request from a browser becomes, and the row a join across a
   * mount taken as empty carries beside it (R144).
   */
  const joinUi = (call: GraphNode, outcome: Extract<UiOutcome, { kind: 'linked' }>, path: string): void => {
    const edge = uiEdge(call, outcome);
    edges.set(edgeKey(edge), edge);
    if (outcome.baseUrl !== undefined) {
      edge.meta = { ...edge.meta, ...takenMeta(outcome.baseUrl) };
      call.meta = { ...call.meta, ...takenMeta(outcome.baseUrl) };
      tookValue(call, outcome.baseUrl, outcome.targetService);
    }
    if (outcome.mountAssumed !== undefined) {
      const method = String(call.meta?.['method'] ?? '?');
      record(call, mountAssumedFinding(method, path, outcome.entry, outcome.mountAssumed));
    }
  };

  for (const call of [...nodes.values()]) {
    if (call.type !== 'http_out') continue;
    httpOut.total += 1;

    const { outcome, notes, alsoLinked, baseUrl } = resolveCall(call, index);
    for (const note of notes) record(call, note);
    if (baseUrl !== undefined) {
      call.meta = { ...call.meta, ...takenMeta(baseUrl) };
      const target = outcome.kind === 'external' ? (outcome.host ?? 'a third party') : (aimOf(outcome) ?? '?');
      tookValue(call, baseUrl, target);
    }
    if (outcome.kind === 'external' && outcome.host !== undefined && baseUrl !== undefined) {
      // A third party found from the value the setting is given is drawn the
      // way one written in the call is, and is as sure as the value (P77).
      const apiId = makeExternalApiId(outcome.host);
      if (!nodes.has(apiId)) {
        nodes.set(apiId, { id: apiId, type: 'external_api', label: outcome.host, repo: call.repo, meta: { host: outcome.host } });
      }
      call.meta = { ...call.meta, host: outcome.host };
      const edge: GraphEdge = {
        from: call.id,
        to: apiId,
        type: 'calls',
        confidence: baseUrl.deployed ? 'static' : 'heuristic',
        ...(call.file === undefined ? {} : { file: call.file }),
        ...(call.line === undefined ? {} : { line: call.line }),
        meta: takenMeta(baseUrl),
      };
      edges.set(edgeKey(edge), edge);
    }

    if (outcome.kind === 'linked') {
      const edge = callEdge(call, outcome, baseUrl);
      edges.set(edgeKey(edge), edge);
      for (const also of alsoLinked ?? []) {
        const more = callEdge(call, {
          kind: 'linked',
          via: outcome.via,
          runnersUp: [],
          ...also,
        });
        edges.set(edgeKey(more), more);
      }
      httpOut.linked += 1;
      if (outcome.via === 'marker') httpOut.byMarker += 1;
      const routes = routesByService.get(outcome.entry.repo) ?? [];
      if (outcome.via !== 'functionUrl' && answeredOnlyByWildcard(outcome.entry, routes)) record(call, wildcardFinding(call, outcome.entry));
    } else {
      // A binding nothing is found behind is counted with the settings no
      // service claims: both are a name the configuration does not place.
      httpOut[outcome.kind === 'unknownBinding' ? 'unknownEnv' : outcome.kind] += 1;
    }
    const partial = nearMissOf(call, outcome);
    if (partial !== undefined) partials.push(partial);

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

    // A procedure asked for by its path, which has no verb and no URL to match
    // a route with and is joined on the path alone.
    if (call.kind === 'rpc') {
      const outcome = resolveProcedureCall(call, procedureIndex);
      const finding = procedureFindingFor(outcome, call);
      if (outcome.kind === 'linked') {
        const edge = procedureEdge(call, outcome);
        edges.set(edgeKey(edge), edge);
        call.meta = { ...call.meta, targetService: outcome.targetService };
        ui.resolved += 1;
      } else {
        ui.unresolved += 1;
        const reason = procedureReasonOf(outcome, call);
        if (reason !== undefined) ui.byReason[reason] = (ui.byReason[reason] ?? 0) + 1;
      }
      if (finding !== undefined) record(call, finding);
      continue;
    }

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
        joinUi(call, each.outcome, each.path);
        call.meta = { ...call.meta, targetService: each.outcome.targetService };
      }
      ui.resolved += 1;
      continue;
    }

    if (outcome.kind === 'linked' && spelledOut?.kind !== 'some') {
      joinUi(call, outcome, String(call.meta?.['path'] ?? '?'));
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
        joinUi(call, each.outcome, each.path);
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
    if (outcome.kind === 'dynamic') {
      const partial = uiNearMissOf(call, uiIndex);
      if (partial !== undefined) partials.push(partial);
    }
    // An address built at run time was already reported where it was written,
    // with the annotation that would fix it; saying it again here adds nothing.
    const finding = uiFindingFor(outcome);
    if (finding !== undefined) record(call, finding);
  }

  found.push(...taken.values());

  // Whatever names an entry by its deployed name alone, joined to the entry in
  // whichever service declares it.
  found.push(...joinReferences(nodes, edges));

  found.push(
    ...auditRoutes(nodes, edges.values(), {
      publicDecorators: config.doctor.publicDecorators,
      publicRoutes: config.doctor.publicRoutes,
      nonGateWrappers: config.doctor.nonGateWrappers,
      skipGuardDecorators: config.doctor.skipGuardDecorators,
    }),
  );

  const channels = surveyChannels(nodes.values(), edges.values());
  const surveyed = surveyRoutes(nodes.values(), edges.values());
  const nearMissed = nearMissesOf(surveyed.uncalled, nodes, partials);
  const routes = Object.keys(nearMissed).length === 0 ? surveyed : { ...surveyed, nearMissed };

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
    totals: totalsOf(project, Object.keys(types).length),
  };

  return { project, report };
};

/**
 * The project's totals, every row count by `countsOf` (P81): a join made from
 * the repository's files is a note, and lowers `missed` by the gap it closed.
 */
const totalsOf = (project: ProjectGraph, types: number): LinkReport['totals'] => {
  const { missed, sites, notes, findings } = countsOf(project.unresolved);
  return {
    nodes: project.nodes.length,
    edges: project.edges.length,
    types,
    missed,
    sites,
    notes,
    findings,
    unresolved: missed,
  };
};

export { configHashOf };
export type { TypeEntry };
