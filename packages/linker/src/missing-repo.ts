import {
  blindSpotPlaces,
  causePartsOf,
  gapIdOf,
  hostOf,
  innerServiceName,
  isInnerHost,
  SEEN_NOT_IN_CODE,
  type GraphEdge,
  type GraphNode,
} from '@flowatlas/core';
import { cmp } from './order.js';
import type { LinkReport } from './report.js';

/**
 * The repository that is probably missing from the project (P122).
 *
 * Commonly, a request rooted at a setting nobody claims, a package nobody
 * installed under the project's own scope, a channel with one end and a route
 * hanging from an API nobody publishes are one fact said four times: a
 * repository that answers them was never added to the configuration. Each of
 * those is read here as a signal - the word it points at and the places it
 * comes from - and the signals that point at one word are put together and
 * ranked, first by how many kinds of evidence agree, then by how many places.
 * Traffic is one more kind (P144): spans from a service the configuration
 * does not list, read from the blind-spot rows P110 makes of what `observe`
 * matched to nothing, so the file is read by whoever counts the rows.
 *
 * Pure: the graph and the link report in, nothing read from anywhere. A guess
 * is all this is (I3): no edge is drawn and nothing is configured from it; what
 * is said about it says why, place by place.
 */

/**
 * The kinds of evidence, strongest first: the order a group's lines are said
 * in. Traffic is last: it agrees with what the code says, and alone it is as
 * often a proxy, a collector or a browser that names itself in its spans.
 */
export const MISSING_KINDS = ['setting', 'host', 'deployment', 'package', 'channel', 'traffic'] as const;
export type MissingKind = (typeof MISSING_KINDS)[number];

/**
 * Kinds that name an address or a deployment nothing configured answers: a
 * group with one of them is worth saying on its own. A package nobody
 * installed and a channel with one end are, alone, as often a checkout without
 * its dependencies or a message nothing reads yet; traffic from a service
 * nobody configured, as often infrastructure that writes spans of its own.
 */
export const STRONG_KINDS: ReadonlySet<MissingKind> = new Set(['setting', 'host', 'deployment']);

/** One place a signal comes from. */
export interface MissingPlace {
  service?: string;
  file?: string;
  line?: number;
  /** The gap id of the row it was read from (`gap:<service>|<file>|<reason>`), when a row said it. */
  gapId?: string;
  /** Of traffic: what one blind-spot group of the service reached, and over which window (P144). */
  seen?: MissingSeen;
}

/** One blind-spot group as evidence: its kind, how many names and spans, the names listed, and the window. */
export interface MissingSeen {
  /** P110's unmatched kind: `http`, `code`, `messaging`, ... */
  kind: string;
  /** Distinct names the group holds, listed or not. */
  places: number;
  /** Spans, over every name. */
  count: number;
  /** The names listed, busiest first (P110 lists five at most). */
  names: string[];
  /** The window, said in words: `2h`. */
  window: string;
}

/** One piece of evidence: what it names, the word it points at, and where. */
export interface MissingSignal {
  kind: MissingKind;
  /** As written: `PAYMENTS_URL`, `@acme/payments-client`, `payment.captured`. */
  name: string;
  /** The word it points at, before normalising: `payments`. */
  token: string;
  /** For a channel, the end nothing here has. */
  lacks?: 'consumer' | 'producer';
  places: MissingPlace[];
}

/** Signals that point at one name, ranked. */
export interface MissingGroup {
  /** The name as the strongest signal writes it: `payments`. */
  token: string;
  /** The name normalised, which is what groups: `payment`. */
  key: string;
  /** Distinct kinds of evidence. */
  score: number;
  /** Places, over every signal. */
  places: number;
  kinds: MissingKind[];
  signals: MissingSignal[];
}

/** A row as any surface holds it: the graph file's (`symbol`) or the database's (`node`). */
export interface MissingRow {
  reason: string;
  service?: string | null;
  file?: string | null;
  line?: number | null;
  symbol?: string | null;
  node?: string | null;
  message?: string | null;
  sites?: number;
  meta?: Record<string, unknown>;
}

/** What is known of a configured service, to drop a name that is one. */
export interface MissingService {
  name: string;
  aliases?: readonly string[];
  hosts?: readonly string[];
  /** Its manifest's name, scope and all. */
  packageName?: string;
}

export interface MissingRepoProject {
  nodes: readonly GraphNode[];
  /** `emits` and `consumes` edges, to name the services at a channel's one end; without them its node's own service. */
  edges?: readonly GraphEdge[];
  unresolved: readonly MissingRow[];
  /** For a host under a domain a configured service is reached at. */
  services?: readonly MissingService[];
}

/* ── Words ── */

/**
 * Words that say what kind of thing a name is, not which: `PAYMENTS_URL`,
 * `paymentsApi`, `payments-client` and `payments-service` all name payments.
 */
const GENERIC = new Set([
  'url', 'uri', 'urls', 'host', 'hostname', 'base', 'api', 'apis', 'service', 'services', 'svc', 'client', 'clients',
  'sdk', 'types', 'typings', 'server', 'endpoint', 'endpoints', 'addr', 'address', 'origin', 'root', 'http', 'https',
  'ws', 'wss', 'upstream', 'internal', 'public', 'remote', 'port',
]);

/** Words of a name a deployment adds for where it runs, never which code: `orders-charge-prod`. */
const STAGE = new Set(['dev', 'development', 'prod', 'production', 'staging', 'stage', 'test', 'qa', 'uat', 'live', 'sandbox', 'local', 'preview']);

const wordsOf = (name: string): string[] =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== '');

/** A plural to its singular, by the three endings that are nearly always one: a stemmer of the separators and the `s`. */
const stem = (word: string): string => {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.endsWith('sses')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
};

/** The words that name something, generic ones left out. */
const namingWords = (name: string): string[] => wordsOf(name).filter((word) => !GENERIC.has(word) && !/^\d+$/.test(word));

/** What groups: the naming words, each stemmed, joined. Empty when nothing names anything. */
export const missingKeyOf = (name: string): string =>
  // An address names no word: `localhost:4000` is itself, port and all.
  name.includes(':') || /^[\d.]+$/.test(name) ? name.toLowerCase() : namingWords(name).map(stem).join('-');

/** The token as said: the naming words as written, joined. */
const tokenOf = (name: string): string => namingWords(name).join('-');

const unscoped = (pkg: string): string => (pkg.startsWith('@') ? (pkg.split('/')[1] ?? '') : pkg);
const scopeOf = (pkg: string | undefined): string | undefined => (pkg?.startsWith('@') === true ? pkg.split('/')[0] : undefined);

/** The service part of a deployed name: stage words and the function's own last word left out. */
const deployedServiceOf = (name: string): string => {
  const words = wordsOf(name).filter((word) => !STAGE.has(word) && !/^v?\d+$/.test(word));
  return (words.length >= 2 ? words.slice(0, -1) : words).join('-');
};

/* ── Signals ── */

const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

const placeOfRow = (row: MissingRow): MissingPlace => ({
  ...(text(row.service) === undefined ? {} : { service: row.service as string }),
  ...(text(row.file) === undefined ? {} : { file: row.file as string }),
  ...(typeof row.line === 'number' && row.line > 0 ? { line: row.line } : {}),
  gapId: gapIdOf({
    reason: row.reason,
    ...(text(row.service) === undefined ? {} : { service: row.service as string }),
    ...(text(row.file) === undefined ? {} : { file: row.file as string }),
  }),
});

const placeOfNode = (node: GraphNode): MissingPlace => ({
  service: node.repo,
  ...(node.file === undefined ? {} : { file: node.file }),
  ...(node.line === undefined || node.line <= 0 ? {} : { line: node.line }),
});

/**
 * The name a host points at, when it is a host of the project's own network:
 * the first label of a name, the cluster's service of a cluster name, and the
 * whole host for `localhost:4000` or an address, which names no repository
 * but which a repository's own files may say it listens on. Nothing for a
 * third party.
 */
const hostToken = (host: string, domains: ReadonlySet<string>): string | undefined => {
  const parsed = hostOf(`http://${host}`);
  if (parsed === undefined) return undefined;
  const { hostname } = parsed;
  const underOwn = [...domains].some((domain) => hostname.endsWith(`.${domain}`));
  if (!isInnerHost(hostname) && !underOwn) return undefined;
  if (hostname === 'localhost' || /^[\d.]+$/.test(hostname) || hostname.includes(':')) return parsed.host;
  return innerServiceName(hostname) ?? hostname.split('.')[0];
};

/** The domains the configured services are reached under: `shop.example.com` for `orders.shop.example.com`. */
const domainsOf = (services: readonly MissingService[]): Set<string> => {
  const out = new Set<string>();
  for (const service of services) {
    for (const host of service.hosts ?? []) {
      const hostname = hostOf(`http://${host}`)?.hostname;
      const labels = hostname?.split('.') ?? [];
      if (labels.length >= 3) out.add(labels.slice(1).join('.'));
    }
  }
  return out;
};

/** The setting a row of `unknown-base-url-env` is about, where no service claims it. */
const UNCLAIMED = /^no service declares (\S+)/;

/** A root key's name: a parameter path's first segment, a state's name. */
const rootName = (key: string): string => {
  if (key.startsWith('parameter:')) return key.slice('parameter:'.length).split('/').find((part) => part !== '') ?? '';
  if (key.startsWith('state:')) return (key.slice('state:'.length).split('#')[0] ?? '').split('/').pop() ?? '';
  return key;
};

/** What each deployment reason names, from its row and the node it is on. */
const DEPLOYED: ReadonlyMap<string, (row: MissingRow, node: GraphNode | undefined) => string | undefined> = new Map([
  ['invoke-target-not-found', (row, node) => text(node?.meta?.['invokes']) ?? /function (\S+), which/.exec(row.message ?? '')?.[1]],
  ['route-root-not-found', (_row, node) => {
    const key = text(node?.meta?.['root']);
    return key === undefined ? undefined : rootName(key);
  }],
  ['function-handler-not-found', (row) => /^(\S+) runs /.exec(row.message ?? '')?.[1]],
]);

/** What a blind-spot row's `meta` says it reached (P110's `blindSpotRows`), or nothing for a row that is not one. */
const seenOfRow = (row: MissingRow): MissingSeen | undefined => {
  const spot = row.meta?.['seen'];
  const window = text(row.meta?.['window']);
  if (spot === null || typeof spot !== 'object' || window === undefined) return undefined;
  const { kind, places, count, names } = spot as Record<string, unknown>;
  if (typeof kind !== 'string' || typeof places !== 'number' || typeof count !== 'number') return undefined;
  const listed = (Array.isArray(names) ? names : []).flatMap((name: unknown): string[] => {
    const said = name !== null && typeof name === 'object' ? (name as { name?: unknown }).name : undefined;
    return typeof said === 'string' ? [said] : [];
  });
  return { kind, places, count, names: listed, window };
};

/** Collects signals by kind and name, so one setting used in seven places is one signal of seven places. */
class Signals {
  readonly #by = new Map<string, MissingSignal>();

  add(kind: MissingKind, name: string, token: string, place: MissingPlace, lacks?: MissingSignal['lacks']): void {
    if (missingKeyOf(token) === '') return;
    const key = `${kind}\u0000${name}\u0000${lacks ?? ''}`;
    const signal = this.#by.get(key) ?? { kind, name, token, ...(lacks === undefined ? {} : { lacks }), places: [] };
    this.#by.set(key, signal);
    const same = signal.places.some(
      (seen) =>
        seen.service === place.service &&
        seen.file === place.file &&
        seen.line === place.line &&
        seen.gapId === place.gapId &&
        seen.seen?.kind === place.seen?.kind,
    );
    if (!same) signal.places.push(place);
  }

  all(): MissingSignal[] {
    return [...this.#by.values()].sort((a, b) => cmp(a.kind, b.kind) || cmp(a.name, b.name));
  }
}

/** The words a channel's transport is called by, from its adapters: `aws-sqs` says `sqs`. */
const transportWords = (node: GraphNode): Set<string> => {
  const adapters = node.meta?.['adapters'];
  return new Set((Array.isArray(adapters) ? adapters : []).flatMap((adapter) => (typeof adapter === 'string' ? wordsOf(adapter) : [])));
};

/** A channel's first segment, its transport's words left off the front: `payment.captured` → `payment`. */
export const channelToken = (node: Pick<GraphNode, 'label' | 'meta'>): string => {
  const transport = transportWords(node as GraphNode);
  const parts = node.label.split('/').filter((part) => part !== '');
  while (parts.length > 1 && transport.has((parts[0] as string).toLowerCase())) parts.shift();
  return (parts[0] ?? '').split(/[.:]/)[0] ?? '';
};

/**
 * Every signal the graph and the report hold (pure).
 *
 * `target-route-not-found` is not one: its service is configured, and what is
 * missing is a route of it.
 */
export const missingRepoSignals = (project: MissingRepoProject, report?: Pick<LinkReport, 'channels' | 'services'>): MissingSignal[] => {
  const nodes = new Map(project.nodes.map((node) => [node.id, node]));
  const signals = new Signals();
  const domains = domainsOf(project.services ?? []);
  const nodeOf = (row: MissingRow): GraphNode | undefined => {
    const id = text(row.symbol) ?? text(row.node);
    return id === undefined ? undefined : nodes.get(id);
  };

  // A setting no service claims, and the hosts its values name (P77).
  for (const row of project.unresolved) {
    if (row.reason !== 'unknown-base-url-env') continue;
    const said = UNCLAIMED.exec(row.message ?? '')?.[1]?.replace(/[;,.]$/, '');
    const node = nodeOf(row);
    const key = text(node?.meta?.['baseUrlEnv']) ?? said;
    if (key === undefined || said === undefined) continue;
    signals.add('setting', key, tokenOf(key), placeOfRow(row));
    const values = node?.meta?.['baseUrlValues'];
    for (const value of Array.isArray(values) ? values : []) {
      const host = typeof value === 'string' ? hostOf(value)?.host : undefined;
      const token = host === undefined ? undefined : hostToken(host, domains);
      if (host !== undefined && token !== undefined) signals.add('host', host, token, placeOfRow(row));
    }
  }

  // A host written in the call that no service is reached at and is not a third party.
  const callsAt = new Map<string, GraphNode[]>();
  for (const node of project.nodes) {
    const host = node.type === 'http_out' ? text(node.meta?.['host']) : undefined;
    if (host !== undefined) callsAt.set(host, [...(callsAt.get(host) ?? []), node]);
  }
  for (const api of project.nodes.filter((node) => node.type === 'external_api')) {
    const host = text(api.meta?.['host']) ?? api.label;
    const token = hostToken(host, domains);
    if (token === undefined) continue;
    const calls = callsAt.get(host) ?? [];
    for (const call of calls.length === 0 ? [api] : calls) signals.add('host', host, token, placeOfNode(call));
  }

  // A package under the project's own scope that nobody installed and no read repository is.
  const own = (report?.services ?? []).map((service) => service.packages?.name).filter((name): name is string => name !== undefined);
  const read = new Set(own);
  const scopes = new Set(own.map(scopeOf).filter((scope): scope is string => scope !== undefined));
  for (const row of project.unresolved) {
    for (const part of causePartsOf(row)) {
      const pkg = part.package;
      if (part.cause !== 'module-not-installed' || pkg === undefined || read.has(pkg)) continue;
      const scope = scopeOf(pkg);
      if (scope === undefined || !scopes.has(scope)) continue;
      const places = part.samples.length === 0 ? [{ file: row.file ?? '', line: row.line ?? 0 }] : part.samples;
      for (const sample of places) {
        signals.add('package', pkg, tokenOf(unscoped(pkg)), placeOfRow({ ...row, file: sample.file, line: sample.line }));
      }
    }
  }

  // A channel with one end.
  const ends = (id: string, type: 'emits' | 'consumes'): GraphNode[] =>
    (project.edges ?? [])
      .filter((edge) => edge.type === type && (type === 'emits' ? edge.to === id : edge.from === id))
      .map((edge) => nodes.get(type === 'emits' ? edge.from : edge.to))
      .filter((node): node is GraphNode => node !== undefined);
  const channelSignal = (id: string, lacks: 'consumer' | 'producer'): void => {
    const channel = nodes.get(id);
    if (channel === undefined) return;
    const there = ends(id, lacks === 'consumer' ? 'emits' : 'consumes');
    for (const node of there.length === 0 ? [channel] : there) signals.add('channel', channel.label, channelToken(channel), placeOfNode(node), lacks);
  };
  // The report's lists; a report without them (a hand-built one) by the counts each channel node keeps.
  const listed = (key: 'noConsumers' | 'noProducers', count: 'consumers' | 'producers'): readonly string[] => {
    const ids = report?.channels?.[key];
    return Array.isArray(ids) ? ids : project.nodes.filter((node) => node.type === 'channel' && node.meta?.[count] === 0).map((node) => node.id);
  };
  for (const id of listed('noConsumers', 'consumers')) channelSignal(id, 'consumer');
  for (const id of listed('noProducers', 'producers')) channelSignal(id, 'producer');

  // A deployment that starts or roots something no configured service declares.
  for (const row of project.unresolved) {
    const named = DEPLOYED.get(row.reason)?.(row, nodeOf(row));
    if (named !== undefined && named !== '') signals.add('deployment', named, deployedServiceOf(named), placeOfRow(row));
  }

  // Traffic from a service no configured service is (P144): a blind spot's
  // own service, by name. One place per blind-spot group (service and kind),
  // each with what it reached and when; a configured service's blind spots
  // are a question for a reader, never for a repository.
  const configured = new Set([
    ...(report?.services ?? []).map((service) => service.name),
    ...(project.services ?? []).map((service) => service.name),
  ]);
  for (const row of project.unresolved) {
    const service = row.reason === SEEN_NOT_IN_CODE ? text(row.service) : undefined;
    const seen = service === undefined || configured.has(service) ? undefined : seenOfRow(row);
    if (service !== undefined && seen !== undefined) signals.add('traffic', service, tokenOf(service), { ...placeOfRow(row), seen });
  }

  return signals.all();
};

/* ── Ranking ── */

/** Every name a configured service goes by, normalised: a token that is one is a join problem, not a repository. */
const configuredKeys = (services: readonly MissingService[]): Set<string> => {
  const out = new Set<string>();
  const add = (name: string | undefined): void => {
    const key = name === undefined ? '' : missingKeyOf(name);
    if (key !== '') out.add(key);
  };
  for (const service of services) {
    add(service.name);
    for (const alias of service.aliases ?? []) add(alias);
    for (const host of service.hosts ?? []) {
      const hostname = hostOf(`http://${host}`)?.hostname;
      add(hostname === undefined ? undefined : (innerServiceName(hostname) ?? hostname.split('.')[0]));
    }
    if (service.packageName !== undefined) add(unscoped(service.packageName));
  }
  return out;
};

const kindRank = (kind: MissingKind): number => MISSING_KINDS.indexOf(kind);

/**
 * Signals put together by the name they point at and ranked (pure): by
 * distinct kinds of evidence, then by places, then by name. A name that is a
 * configured service's - its name, an alias, a host, its package - is left
 * out. `top` keeps the first few; absent, every group.
 */
export const rankMissing = (
  signals: readonly MissingSignal[],
  services: readonly MissingService[],
  options: { top?: number } = {},
): MissingGroup[] => {
  const configured = configuredKeys(services);
  const byKey = new Map<string, MissingSignal[]>();
  for (const signal of signals) {
    const key = missingKeyOf(signal.token);
    if (key === '' || configured.has(key)) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), signal]);
  }
  const groups = [...byKey.entries()].map(([key, list]): MissingGroup => {
    const ordered = [...list].sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || b.places.length - a.places.length || cmp(a.name, b.name));
    const kinds = [...new Set(ordered.map((signal) => signal.kind))];
    return {
      token: (ordered[0] as MissingSignal).token,
      key,
      score: kinds.length,
      places: ordered.reduce((sum, signal) => sum + signal.places.length, 0),
      kinds,
      signals: ordered,
    };
  });
  groups.sort((a, b) => b.score - a.score || b.places - a.places || cmp(a.key, b.key));
  return options.top === undefined ? groups : groups.slice(0, options.top);
};

/**
 * Whether a group is worth saying where only the likeliest are: evidence of
 * an address or a deployment, two kinds that agree, or a directory on disk
 * that looks like it. A lone package or a lone channel is listed only when
 * every group is asked for (`doctor --missing`).
 */
export const worthSaying = (group: Pick<MissingGroup, 'kinds'>, candidates = 0): boolean =>
  candidates > 0 || group.kinds.length >= 2 || group.kinds.some((kind) => STRONG_KINDS.has(kind));

/** The services a signal's places are in, sorted. */
export const servicesOfSignal = (signal: MissingSignal): string[] =>
  [...new Set(signal.places.map((place) => place.service).filter((service): service is string => service !== undefined))].sort(cmp);

const plural = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`;
const andList = (items: readonly string[]): string =>
  items.length <= 1 ? (items[0] ?? 'nothing') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

/** One signal, as one sentence: what it is, who has it, and what is missing. */
const SAYS: { readonly [K in MissingKind]: (signal: MissingSignal, by: string) => string } = {
  setting: (signal, by) => `${signal.name} is used by ${by} (${plural(signal.places.length, 'request')}) and no service claims it`,
  host: (signal, by) => `${signal.name} is called by ${by} and no configured service is reached at it`,
  deployment: (signal, by) => `${signal.name} is deployed or named by ${by} and no configured service deploys it`,
  package: (signal, by) => `${signal.name} is imported by ${by} and is not installed`,
  channel: (signal, by) =>
    signal.lacks === 'producer'
      ? `channel ${signal.name} is consumed by ${by} and nothing here publishes it`
      : `channel ${signal.name} is published by ${by} and nobody here consumes it`,
  traffic: (signal) => `traffic came from ${signal.name}, which no configured service is: ${saySeenAll(signal.places)}`,
};

const seenOf = (places: readonly MissingPlace[]): MissingSeen[] =>
  places.flatMap((place) => (place.seen === undefined ? [] : [place.seen]));

/** What every blind-spot group of a signal reached, together: `2 routes and 2 methods, 8 spans in 2h`. */
const saySeenAll = (places: readonly MissingPlace[]): string => {
  const seen = seenOf(places);
  const spans = seen.reduce((sum, one) => sum + one.count, 0);
  const windows = [...new Set(seen.map((one) => one.window))];
  const over = windows.length === 1 ? ` in ${windows[0]}` : '';
  return `${andList(seen.map((one) => blindSpotPlaces(one.kind, one.places)))}, ${plural(spans, 'span')}${over}`;
};

/** One blind-spot group, as `doctor --missing` says the place: `2 routes, 4 spans in 2h: POST /charges, POST /refunds`. */
export const saySeen = (seen: MissingSeen): string => {
  const more = seen.places - seen.names.length;
  const listed = seen.names.length === 0 ? '' : `: ${seen.names.join(', ')}${more > 0 ? `, and ${more} more` : ''}`;
  return `${blindSpotPlaces(seen.kind, seen.places)}, ${plural(seen.count, 'span')} in ${seen.window}${listed}`;
};

export const saySignal = (signal: MissingSignal): string => SAYS[signal.kind](signal, andList(servicesOfSignal(signal)));

/** `3 kinds of evidence, 7 places`. */
export const sayEvidence = (group: Pick<MissingGroup, 'score' | 'places'>): string =>
  `${plural(group.score, 'kind')} of evidence, ${plural(group.places, 'place')}`;

/** What a graph is asked for its signals: a database, or anything that answers the same. */
export interface MissingRepoReader {
  allNodes(): GraphNode[];
  edgesTo(id: string, types?: readonly string[]): GraphEdge[];
  edgesFrom(id: string, types?: readonly string[]): GraphEdge[];
  report(): LinkReport | undefined;
}

/** The services the report names, by name and manifest name: what a graph alone knows of them. */
export const servicesOfReport = (report: Pick<LinkReport, 'services'> | undefined): MissingService[] =>
  (report?.services ?? []).map((service) => ({
    name: service.name,
    ...(service.packages?.name === undefined ? {} : { packageName: service.packages.name }),
  }));

/**
 * The groups of one graph: its nodes, the edges at a channel with one end,
 * the report, and the rows as the surface asking counts them. `services` adds
 * what the configuration knows (aliases, hosts) to what the report does.
 */
export const missingGroupsOf = (
  db: MissingRepoReader,
  rows: readonly MissingRow[],
  services: readonly MissingService[] = [],
  options: { top?: number } = {},
): MissingGroup[] => {
  const report = db.report();
  const ids = [...(report?.channels?.noConsumers ?? []), ...(report?.channels?.noProducers ?? [])];
  const edges = ids.flatMap((id) => [...db.edgesTo(id, ['emits']), ...db.edgesFrom(id, ['consumes'])]);
  const known = servicesOfReport(report);
  const merged = known.map((service) => ({ ...service, ...services.find((each) => each.name === service.name) }));
  const all = [...merged, ...services.filter((service) => !known.some((each) => each.name === service.name))];
  return rankMissing(missingRepoSignals({ nodes: db.allNodes(), edges, unresolved: rows, services: all }, report), all, options);
};

/**
 * The gap ids each group's evidence came from, by the group's name, likeliest
 * group first: what a check's prompt names as the repository probably missing.
 * Groups no row speaks for are left out.
 */
export const missingByGap = (groups: readonly MissingGroup[]): Array<[token: string, gapIds: string[]]> =>
  groups.flatMap((group): Array<[string, string[]]> => {
    const ids = [...new Set(group.signals.flatMap((signal) => signal.places.map((place) => place.gapId)).filter((id): id is string => id !== undefined))].sort(cmp);
    return ids.length === 0 ? [] : [[group.token, ids]];
  });

/** The repository probably missing that one gap is evidence for, by name: the likeliest group's that counts it. */
export const missingTokenOfGap = (byGap: ReadonlyArray<readonly [string, readonly string[]]>, gapId: string): string | undefined =>
  byGap.find(([, ids]) => ids.includes(gapId))?.[0];
