import { createHash } from 'node:crypto';
import { readAccepted, wayInBodyRead, type GraphEdge, type GraphNode } from '@flowatlas/core';
import { acceptedSplitOf, neverSeen, type GraphDb } from '@flowatlas/linker';
import { blindSpotsBeside, cantFollowFor, deadOptionsOf, deadRows, loadContractBreaks, rankedFindingsOf, rulesReportOf, type DbHandle } from '@flowatlas/mcp';
import { loadGraph } from '../analysis/graph.js';
import { tarjanScc } from '../analysis/scc.js';
import { CYCLE_EDGES } from '../commands/cycles.js';
import { driftOf } from '../commands/types.js';
import { readObservedBeside } from '../observe/store.js';

/**
 * The page a person reads first (P228): what the project is, what crosses
 * between its services, what most of it depends on, what is worth a second
 * look, what was not read, and the questions to ask next.
 *
 * Every row is one the graph holds, with where it is; nothing is clustered,
 * scored or summarised in prose (D1, §2 Out). The services are the groups,
 * declared by the configuration; load is ranked by how many ways in reach a
 * thing and from how many services, not by degree; "worth a second look" is
 * five definitions, not a guess. One model, rendered by `flowatlas report`,
 * by the `overview` doc block, and by the graph server's `flowatlas://overview`.
 */
export const OVERVIEW_SECTIONS = ['services', 'crossings', 'load', 'second-look', 'not-read', 'checks', 'run-time', 'questions'] as const;
export type OverviewSection = (typeof OVERVIEW_SECTIONS)[number];

/** Most rows of each list, when nobody says. */
export const DEFAULT_OVERVIEW_TOP = 10;

/** How far a walk from a way in goes to count what it reaches: as far as `flow` goes. */
const REACH_DEPTH = 8;

export interface OverviewService {
  name: string;
  type: string;
  /** What the service is for, from what it holds: a browser, an API, functions, a worker, or a library. */
  role: 'browser' | 'api' | 'functions' | 'worker' | 'library';
  /** Ways in by kind. */
  waysIn: Record<string, number>;
  /** Ways in whose handler's body was read, of all of them (`doctor`'s figure). */
  read: number;
  total: number;
  skipped?: string;
}

/** What crosses from one service to another, counted apart. */
export interface Crossing {
  from: string;
  to: string;
  /** Requests: a call to another service's route, or a browser's call to it. */
  requests: number;
  /** Messages: a publish in `from` that a handler in `to` takes. */
  messages: number;
  /** Stores `from` reaches that `to` owns. */
  stores: number;
  /** Of all of it, joined by a best guess. */
  guessed: number;
}

export interface Loaded {
  id: string;
  label: string;
  service: string | null;
  loc?: string;
  /** How many ways in reach it, and from how many services, for a method; callers, handlers or writers otherwise. */
  count: number;
  services: string[];
}

export interface SecondLook {
  kind: 'single-thread' | 'shared-store' | 'guess-carrying-weight';
  /** One sentence, with the services and names it is about. */
  says: string;
  /** Where to look: `service/file:line`, or the ids. */
  at: string[];
  confidence?: string;
}

export interface NotRead {
  cause: string;
  sites: number;
  services: string[];
  hint: string;
}

export interface Check {
  name: string;
  count: number;
  command: string;
}

export interface Overview {
  services: OverviewService[];
  crossings: Crossing[];
  load: { methods: Loaded[]; routes: Loaded[]; channels: Loaded[]; tables: Loaded[] };
  secondLook: SecondLook[];
  /** The ways-in reach above which a best guess carries weight (D3), said so the threshold is visible. */
  weightAt: number;
  notRead: { causes: NotRead[]; sites: number };
  checks: Check[];
  runTime?: Check[];
  questions: Array<{ ask: string; command: string; tool: string }>;
  /** How many rows each list left out under `top`. */
  cut: Record<string, number>;
}

const locOf = (node: GraphNode | undefined): string | undefined =>
  node?.file === undefined ? undefined : `${node.repo}/${node.file}${node.line === undefined ? '' : `:${node.line}`}`;

const roleOf = (nodes: readonly GraphNode[]): OverviewService['role'] => {
  if (nodes.some((node) => node.type === 'ui_action' || node.type === 'ui_api_call')) return 'browser';
  const kinds = new Set(nodes.filter((node) => node.type === 'entry').map((node) => node.kind));
  if (kinds.has('http') || kinds.has('rpc')) return 'api';
  if (kinds.has('invoke') || kinds.has('workflow')) return 'functions';
  if (kinds.size > 0 || nodes.some((node) => node.type === 'consumer')) return 'worker';
  return 'library';
};

const top = <T>(rows: T[], n: number, key: string, cut: Record<string, number>): T[] => {
  if (rows.length > n) cut[key] = rows.length - n;
  return rows.slice(0, n);
};

const byCount = (a: Loaded, b: Loaded): number =>
  b.count - a.count || b.services.length - a.services.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The 90th percentile of a list, at least `least` (D3). */
const percentile90 = (values: readonly number[], least: number): number => {
  if (values.length === 0) return least;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.max(least, sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))] as number);
};

export interface OverviewOptions {
  top?: number;
  service?: string;
  /**
   * Only what the fingerprint covers - services, crossings, shared stores,
   * single threads - with no walk and nothing read beside the graph: what a
   * check of a committed overview needs, on either side of a diff (D2).
   */
  structureOnly?: boolean;
}

/**
 * The overview of the graph `db`, with what the server's tools read beside it
 * at `handle`; with `structureOnly`, only the structure, and no handle needed.
 */
export const overviewOf = (db: GraphDb, handle: DbHandle | undefined, options: OverviewOptions = {}): Overview => {
  const n = options.top ?? DEFAULT_OVERVIEW_TOP;
  const cut: Record<string, number> = {};
  const nodes = db.allNodes();
  const edges = db.allEdges();
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const repoOf = (id: string): string | undefined => byId.get(id)?.repo;
  const relevant = (...services: Array<string | undefined | null>): boolean =>
    options.service === undefined || services.some((service) => service === options.service);

  // Services: what each is, its ways in, how many of them were read to the end.
  const handled = (id: string): boolean => db.edgesFrom(id, ['handles']).length > 0;
  const services: OverviewService[] = db.services().map((summary) => {
    const own = nodes.filter((node) => node.repo === summary.name);
    const entries = own.filter((node) => node.type === 'entry');
    const waysIn: Record<string, number> = {};
    for (const entry of entries) waysIn[entry.kind ?? 'other'] = (waysIn[entry.kind ?? 'other'] ?? 0) + 1;
    return {
      name: summary.name,
      type: summary.type,
      role: roleOf(own),
      waysIn,
      read: entries.filter((entry) => wayInBodyRead(entry, handled)).length,
      total: entries.length,
      ...(summary.skipped === undefined ? {} : { skipped: summary.skipped }),
    };
  });

  // Crossings: requests, messages through a channel, stores, each read from an edge.
  const pairs = new Map<string, Crossing>();
  const pair = (from: string, to: string): Crossing => {
    const key = `${from}\n${to}`;
    let found = pairs.get(key);
    if (found === undefined) {
      found = { from, to, requests: 0, messages: 0, stores: 0, guessed: 0 };
      pairs.set(key, found);
    }
    return found;
  };
  const guessed = (edge: GraphEdge): number => (edge.confidence === 'heuristic' ? 1 : 0);
  for (const edge of edges) {
    const from = repoOf(edge.from);
    const to = repoOf(edge.to);
    if (from === undefined || to === undefined || from === to) continue;
    if (edge.type === 'http_calls' || edge.type === 'hits' || edge.type === 'triggers') {
      const crossing = pair(from, to);
      crossing.requests += 1;
      crossing.guessed += guessed(edge);
    } else if (edge.type === 'queries' || edge.type === 'caches') {
      const crossing = pair(from, to);
      crossing.stores += 1;
      crossing.guessed += guessed(edge);
    }
  }
  const channels = nodes.filter((node) => node.type === 'channel');
  for (const channel of channels) {
    const publishers = db.edgesTo(channel.id, ['emits']);
    const handlers = db.edgesFrom(channel.id, ['consumes']);
    for (const publish of publishers) {
      for (const handle of handlers) {
        const from = repoOf(publish.from);
        const to = repoOf(handle.to);
        if (from === undefined || to === undefined || from === to) continue;
        const crossing = pair(from, to);
        crossing.messages += 1;
        crossing.guessed += Math.max(guessed(publish), guessed(handle));
      }
    }
  }
  const crossings = [...pairs.values()]
    .filter((crossing) => relevant(crossing.from, crossing.to))
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : 0));

  // Load: what the ways in reach, counted once per way in.
  const entries = nodes.filter((node) => node.type === 'entry' || node.type === 'ui_action');
  const reachedBy = new Map<string, { entries: number; services: Set<string> }>();
  for (const entry of options.structureOnly === true ? [] : entries) {
    for (const row of db.forwardReach(entry.id, { maxDepth: REACH_DEPTH }).rows) {
      if (row.id === entry.id) continue;
      const known = reachedBy.get(row.id) ?? { entries: 0, services: new Set<string>() };
      known.entries += 1;
      known.services.add(entry.repo);
      reachedBy.set(row.id, known);
    }
  }
  const loadedOf = (node: GraphNode, count: number, services: Iterable<string>): Loaded => ({
    id: node.id,
    label: node.label,
    service: node.repo ?? null,
    ...(locOf(node) === undefined ? {} : { loc: locOf(node) as string }),
    count,
    services: [...new Set(services)].sort(),
  });
  const methods = nodes
    .filter((node) => (node.type === 'method' || node.type === 'function') && reachedBy.has(node.id) && relevant(node.repo))
    .map((node) => loadedOf(node, reachedBy.get(node.id)!.entries, reachedBy.get(node.id)!.services))
    .sort(byCount);
  const routes = nodes
    .filter((node) => node.type === 'entry' && relevant(node.repo))
    .map((node) => {
      const callers = db.edgesTo(node.id, ['http_calls', 'hits', 'triggers']).map((edge) => repoOf(edge.from)).filter((repo): repo is string => repo !== undefined && repo !== node.repo);
      return loadedOf(node, callers.length, callers);
    })
    .filter((row) => row.count > 0)
    .sort(byCount);
  const channelLoad = channels
    .map((node) => {
      const handlers = db.edgesFrom(node.id, ['consumes']).map((edge) => repoOf(edge.to)).filter((repo): repo is string => repo !== undefined);
      return loadedOf(node, handlers.length, handlers);
    })
    .filter((row) => row.count > 0 && relevant(...row.services))
    .sort(byCount);
  const writersOf = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.type !== 'queries') continue;
    const query = byId.get(edge.from);
    if (query?.meta?.['op'] !== 'write' || query.repo === undefined) continue;
    const writers = writersOf.get(edge.to) ?? new Set<string>();
    writers.add(query.repo);
    writersOf.set(edge.to, writers);
  }
  const tables = [...writersOf]
    .map(([id, writers]) => ({ node: byId.get(id), writers }))
    .filter((item): item is { node: GraphNode; writers: Set<string> } => item.node !== undefined)
    .map(({ node, writers }) => loadedOf(node, writers.size, writers))
    .filter((row) => relevant(row.service, ...row.services))
    .sort(byCount);

  // Worth a second look: three definitions, each with where to look (§1 point 3).
  const secondLook: SecondLook[] = [];
  const counted = new Map<string, number>();
  for (const crossing of pairs.values()) {
    const key = [crossing.from, crossing.to].sort().join('\n');
    counted.set(key, (counted.get(key) ?? 0) + crossing.requests + crossing.messages + crossing.stores);
  }
  for (const [key, total] of [...counted].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (total !== 1) continue;
    const [a, b] = key.split('\n') as [string, string];
    if (!relevant(a, b)) continue;
    const edge = edges.find((item) => {
      const ends = [repoOf(item.from), repoOf(item.to)];
      return ['http_calls', 'hits', 'triggers', 'queries', 'caches'].includes(item.type) && ends.includes(a) && ends.includes(b);
    });
    secondLook.push({
      kind: 'single-thread',
      says: `${a} and ${b} are joined by one thing alone: easy to miss in a review, and the one that breaks between them`,
      at: edge === undefined ? [] : [locOf(byId.get(edge.from)) ?? edge.from],
      ...(edge === undefined ? {} : { confidence: edge.confidence }),
    });
  }
  for (const row of tables) {
    if (row.services.length < 2) continue;
    secondLook.push({
      kind: 'shared-store',
      says: `${row.label} is written by ${row.services.join(' and ')}: a boundary two services share`,
      at: edges
        .filter((edge) => edge.type === 'queries' && edge.to === row.id && byId.get(edge.from)?.meta?.['op'] === 'write')
        .map((edge) => locOf(byId.get(edge.from)) ?? edge.from)
        .sort(),
    });
  }
  if (options.structureOnly === true || handle === undefined) {
    return {
      services: services.filter((service) => relevant(service.name)),
      crossings,
      load: { methods: [], routes: [], channels: [], tables },
      secondLook,
      weightAt: 0,
      notRead: { causes: [], sites: 0 },
      checks: [],
      questions: [],
      cut,
    };
  }
  const weightAt = percentile90([...reachedBy.values()].map((item) => item.entries), 3);
  for (const edge of edges) {
    if (edge.confidence !== 'heuristic') continue;
    const reach = reachedBy.get(edge.to)?.entries ?? 0;
    if (reach < weightAt || !relevant(repoOf(edge.from), repoOf(edge.to))) continue;
    secondLook.push({
      kind: 'guess-carrying-weight',
      says: `a best guess from ${byId.get(edge.from)?.label ?? edge.from} to ${byId.get(edge.to)?.label ?? edge.to} is on the way of ${reach} ways in`,
      at: [locOf(byId.get(edge.from)) ?? edge.from],
      confidence: 'heuristic',
    });
  }

  // What was not read, grouped by cause.
  const accepted = readAccepted(handle.path);
  const split = acceptedSplitOf(db, db.allUnresolved(), accepted);
  const fresh = options.service === undefined ? split.fresh : split.fresh.filter((row) => row.service === options.service);
  const grouped = cantFollowFor(db, fresh, { top: n, samples: 1 });
  const notRead = {
    sites: grouped.total.sites,
    causes: grouped.causes.map((cause) => ({ cause: cause.label, sites: cause.sites, services: cause.services, hint: cause.hint })),
  };

  // Checks: counts, each with the command that lists it.
  const rules = rulesReportOf(db, { handle });
  const contractBreaks = loadContractBreaks(handle.path);
  const findings = rankedFindingsOf(db, split.fresh, contractBreaks, rules?.violations).filter((row) => relevant(row.service));
  const findingCount = (kind: string): number => findings.filter((row) => row.kind === kind).length;
  const cycles = tarjanScc(loadGraph(db, { edgeTypes: [...CYCLE_EDGES], collapseChannels: true }), { minLength: 2 }).filter((cycle) => cycle.crossService);
  const dead = deadRows(db, deadOptionsOf(handle, options.service), ['entries']).filter((row) => row.verdict === 'dead');
  const drift = driftOf(db.allTypes(options.service === undefined ? {} : { repo: options.service }));
  const checks: Check[] = [
    { name: 'contract breaks', count: contractBreaks.filter((item) => item.severity === 'error' && relevant(repoOf(item.edge.from), repoOf(item.edge.to))).length, command: 'flowatlas contracts' },
    ...(rules === undefined ? [] : [{ name: 'architecture rules broken', count: rules.violations.filter((item) => relevant(item.fromService, item.toService)).length, command: 'flowatlas rules' }]),
    { name: 'cycles across services', count: cycles.length, command: 'flowatlas cycles' },
    { name: 'dead ways in', count: dead.length, command: 'flowatlas dead' },
    { name: 'routes with no guard', count: findingCount('route-unguarded'), command: 'flowatlas doctor --reason route-unguarded' },
    { name: 'likely N+1 queries', count: findingCount('query-in-loop'), command: 'flowatlas doctor --reason query-in-loop' },
    { name: 'channels with one end', count: findingCount('one-ended-channel'), command: 'flowatlas channel <name>' },
    { name: 'types two services disagree about', count: drift.length, command: 'flowatlas types --drift' },
  ];

  // Run time, only when something was observed.
  const observed = readObservedBeside(handle.path).observed;
  const runTime: Check[] | undefined =
    observed === undefined
      ? undefined
      : [
          { name: 'ways in never seen in traffic', count: neverSeen(db, observed).rows.filter((row) => relevant(row.service)).length, command: 'flowatlas observe --never-seen' },
          { name: 'places traffic reached that no reader drew', count: blindSpotsBeside(handle.path).length, command: 'flowatlas doctor --reason seen-not-in-code' },
        ];

  // Questions, built from the rows above: at most two of a kind (D4).
  const questions: Overview['questions'] = [];
  for (const method of methods.slice(0, 2)) {
    questions.push({
      ask: `What breaks if ${method.label} changes? ${method.count} ways in reach it, from ${method.services.join(', ')}.`,
      command: `flowatlas impact ${JSON.stringify(method.id)}`,
      tool: `impact({symbol: ${JSON.stringify(method.id)}})`,
    });
  }
  for (const route of routes.slice(0, 2)) {
    questions.push({
      ask: `What does ${route.label} do, end to end? ${route.services.join(', ')} ${route.services.length === 1 ? 'calls' : 'call'} it.`,
      command: `flowatlas flow ${JSON.stringify(route.id)}`,
      tool: `get_flow({entry: ${JSON.stringify(route.id)}})`,
    });
  }
  for (const store of tables.filter((row) => row.services.length > 1).slice(0, 1)) {
    questions.push({ ask: `Who writes ${store.label}, and why two services?`, command: `flowatlas explain ${JSON.stringify(store.id)}`, tool: `describe_for_prompt({id: ${JSON.stringify(store.id)}})` });
  }
  const lonely = channels.find((channel) => db.edgesFrom(channel.id, ['consumes']).length === 0 && relevant(channel.repo));
  if (lonely !== undefined) {
    questions.push({ ask: `Does anything handle ${lonely.label}?`, command: `flowatlas channel ${JSON.stringify(lonely.label)}`, tool: `who_consumes({channel: ${JSON.stringify(lonely.label)}})` });
  }
  const biggest = notRead.causes[0];
  if (biggest !== undefined) {
    questions.push({ ask: `Why does the reading stop at ${biggest.cause} (${biggest.sites} places)?`, command: 'flowatlas doctor --unresolved', tool: `cant_follow({cause: ${JSON.stringify(biggest.cause.split(':')[0])}})` });
  }
  questions.push({ ask: 'What does this branch change, and is it safe to merge?', command: 'flowatlas diff origin/main', tool: 'what_changed({verdict: true})' });

  return {
    services: services.filter((service) => relevant(service.name)),
    crossings,
    load: {
      methods: top(methods, n, 'methods', cut),
      routes: top(routes, n, 'routes', cut),
      channels: top(channelLoad, n, 'channels', cut),
      tables: top(tables, n, 'tables', cut),
    },
    secondLook: top(secondLook, n * 2, 'secondLook', cut),
    weightAt,
    notRead,
    checks,
    ...(runTime === undefined ? {} : { runTime }),
    questions,
    cut,
  };
};

/**
 * What a committed overview is checked against (D2): the structure, never a
 * count. The services, which pairs cross and by what kind, the shared stores
 * and the single threads. A route added moves none of it; a new crossing, a
 * second writer or a thread appearing does.
 */
export const overviewFingerprint = (overview: Overview): string => {
  const structure = {
    services: overview.services.map((service) => [service.name, service.type, service.role]),
    crossings: overview.crossings.map((crossing) => [crossing.from, crossing.to, crossing.requests > 0, crossing.messages > 0, crossing.stores > 0]),
    shared: overview.secondLook.filter((item) => item.kind === 'shared-store').map((item) => item.says),
    threads: overview.secondLook.filter((item) => item.kind === 'single-thread').map((item) => item.says),
  };
  return createHash('sha256').update(JSON.stringify(structure)).digest('hex').slice(0, 8);
};
