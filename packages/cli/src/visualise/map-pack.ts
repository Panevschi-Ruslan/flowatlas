import type { GraphNode } from '@flowatlas/core';
import type { AnchoredUnresolvedRow, ServiceReport } from '@flowatlas/linker';

/**
 * The whole project at the size of its services, for the Map tab.
 *
 * Every node is owned by one box: a service owns what it declares, a channel
 * is a box of its own because it is shared by whoever sends and receives on
 * it, a service's tables are one box beside it (its data), and an outside API
 * is a box. An edge whose two ends are owned by different boxes is part of a
 * link between them, counted, with the edges kept so the page can list them.
 * Nothing is drawn per node: a project of twelve thousand nodes is a hairball
 * at any zoom, and the shape a person asks for first is the services and what
 * joins them.
 *
 * A second, build-time layer comes from the manifests: a service depending on
 * the package another service publishes is a link between the two, and a
 * package two or more services use is a box of its own.
 */

/** What a box stands for. */
export const BOX_KINDS = ['service', 'channel', 'data', 'external', 'package'] as const;
export type BoxKind = (typeof BOX_KINDS)[number];

/**
 * Columns, left to right, in the order a request travels: what a person
 * clicks, what answers it, what carries a message on, what does the work, the
 * code they share, and where it ends - data, the outside, the packages.
 */
export const COLUMNS = ['front', 'api', 'channel', 'worker', 'library', 'data', 'external', 'package'] as const;
export type Column = (typeof COLUMNS)[number];

/** What passes along a link. */
export const LINK_KINDS = ['http', 'message', 'workflow', 'invoke', 'db', 'external', 'calls', 'package'] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

/** A cluster needs this many members to be worth a frame. */
export const CLUSTER_MIN = 3;

export interface MapBox {
  /** Index into `BOX_KINDS`. */
  k: number;
  /** The service's, channel's, host's or package's name; a data box carries its service's. */
  n: string;
  /** Index into `COLUMNS`. */
  c: number;
  /** The cluster it is drawn in, '' for none. */
  g: string;
  /** A node the Graph tab can centre on for it, by position; -1 for none. */
  a: number;
  /** Counts the box shows and the checks read; see `statsOf`. */
  s: Record<string, number>;
}

export interface MapLink {
  /** Box positions. */
  f: number;
  t: number;
  /** Index into `LINK_KINDS`. */
  k: number;
  /** How many edges, or how many manifests, it stands for. */
  n: number;
  /** Best and worst confidence among its edges, as indices into the pack's confidences; absent on a manifest link. */
  b?: number;
  w?: number;
  /** The edges, as positions in the packed edge list; absent on a manifest link, which stands for none. */
  e?: number[];
  /** A development dependency only. */
  d?: 1;
  /** The package named, for a manifest link between two services. */
  p?: string;
}

export interface PackedMap {
  boxes: MapBox[];
  links: MapLink[];
  /** Every package any manifest names, sorted. */
  packages: string[];
  /** Per service box: what its manifest depends on, as `packages` positions; absent without a manifest. */
  manifests: Record<number, { name?: string; runtime: number[]; dev: number[] }>;
}

export interface MapInput {
  nodes: readonly GraphNode[];
  /** The packed edges: `[from, to, type, confidence]` by position and dictionary index. */
  edges: readonly number[][];
  edgeTypes: readonly string[];
  confidences: readonly string[];
  services: readonly Pick<ServiceReport, 'name' | 'type' | 'skipped' | 'packages'>[];
  rows: readonly Pick<AnchoredUnresolvedRow, 'service' | 'level'>[];
}

/** Best first, as the walk ranks them. */
const CONFIDENCE_RANK = ['static', 'marker', 'declared', 'runtime', 'heuristic'];

/** Edges that are plumbing or bookkeeping, not something passing between two parts. */
const NOT_A_LINK = new Set(['guarded_by', 'imports', 'reads_config']);

const UI_TYPES = new Set(['ui_component', 'ui_action', 'ui_api_call']);
const ASKED_KINDS = new Set(['http', 'bot_command', 'bot_callback', 'bot_event', 'scene_step', 'rpc']);

/**
 * What a service is for, from what it declares: a front end has screens and
 * no routes, an API answers requests, a worker is reached only by messages,
 * schedules, functions or workflows - or consumes from a channel - and a
 * library is reached by nothing but the code that imports it.
 */
const roleOf = (entries: Record<string, number>, ui: number, consumers: number): Column => {
  const asked = Object.entries(entries).reduce((sum, [kind, n]) => sum + (ASKED_KINDS.has(kind) ? n : 0), 0);
  const any = Object.values(entries).reduce((sum, n) => sum + n, 0);
  if (ui > 0 && (entries['http'] ?? 0) === 0) return 'front';
  if (asked > 0) return 'api';
  if (any > 0 || consumers > 0) return 'worker';
  return 'library';
};

/**
 * The prefixes a family of names can share, longest first, each written as
 * the names write it, separator included: `pay-api-cards` → `pay-api-`,
 * `pay-`; `core.jobs.sync` → `core.jobs.`, `core.`. A prefix leaves at least
 * one word after it, so a family is never one name.
 */
const prefixesOf = (name: string): string[] => {
  const parts = name.split(/([-_./@:]+)/);
  const ends: number[] = [];
  let at = 0;
  for (let i = 0; i < parts.length; i += 1) {
    at += (parts[i] as string).length;
    if (i % 2 === 1 && parts[i - 1] !== '' && at < name.length) ends.push(at);
  }
  const out: string[] = [];
  if (ends.length >= 2) out.push(name.slice(0, ends[1]));
  if (ends.length >= 1) out.push(name.slice(0, ends[0]));
  return out;
};

/**
 * Families of names in one column, longest prefix first: a two-word prefix
 * at least `CLUSTER_MIN` names share is a family, and a one-word prefix is a
 * family of the names no longer prefix claimed, if there are still enough of
 * them - so `pay-web` beside three `pay-api-*` is on its own rather than a
 * family of one. Deterministic, so the same project draws the same frames.
 */
export const clustersOf = (names: readonly string[]): string[] => {
  const out = names.map(() => '');
  for (const depth of [0, 1]) {
    const counts = new Map<string, number>();
    const candidate = names.map((name, i) => {
      if (out[i] !== '') return undefined;
      const prefixes = prefixesOf(name);
      const prefix = prefixes.length === 2 ? prefixes[depth] : depth === 1 ? prefixes[0] : undefined;
      if (prefix !== undefined) counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
      return prefix;
    });
    candidate.forEach((prefix, i) => {
      if (prefix !== undefined && (counts.get(prefix) ?? 0) >= CLUSTER_MIN) out[i] = prefix;
    });
  }
  return out;
};

/** A scope is a package family as its publisher named it: `@aws-sdk/client-sqs` → `@aws-sdk`. */
const scopeOf = (name: string): string => (name.startsWith('@') ? (name.split('/')[0] as string) : '');

/** A box's key while the map is assembled: kind and name, which no two boxes share. */
const boxKey = (kind: BoxKind, name: string): string => `${kind}\u0000${name}`;

const linkKindOf = (edgeType: string, to: GraphNode): LinkKind => {
  if (edgeType === 'hits' || edgeType === 'http_calls') return 'http';
  if (edgeType === 'emits' || edgeType === 'consumes' || edgeType === 'triggers') return 'message';
  if (edgeType === 'queries' || edgeType === 'caches') return 'db';
  if (to.type === 'external_api') return 'external';
  if (to.type === 'entry' && to.kind === 'workflow') return 'workflow';
  if (to.type === 'entry' && to.kind === 'invoke') return 'invoke';
  if (to.type === 'channel') return 'message';
  return 'calls';
};

export const packMap = (input: MapInput): PackedMap => {
  const boxes: MapBox[] = [];
  const index = new Map<string, number>();
  const boxOf = (kind: BoxKind, name: string, column: Column, anchor = -1): number => {
    const key = boxKey(kind, name);
    const found = index.get(key);
    if (found !== undefined) return found;
    boxes.push({ k: BOX_KINDS.indexOf(kind), n: name, c: COLUMNS.indexOf(column), g: '', a: anchor, s: {} });
    index.set(key, boxes.length - 1);
    return boxes.length - 1;
  };

  // A service's own counts first, since its column comes from them.
  const entries = new Map<string, Record<string, number>>();
  const ui = new Map<string, number>();
  const anchors = new Map<string, number>();
  const nodeCount = new Map<string, number>();
  const consumers = new Map<string, number>();
  input.nodes.forEach((node, i) => {
    nodeCount.set(node.repo, (nodeCount.get(node.repo) ?? 0) + 1);
    if (node.type === 'repo' && !anchors.has(node.repo)) anchors.set(node.repo, i);
    if (node.type === 'entry') {
      const kinds = entries.get(node.repo) ?? {};
      const kind = node.kind ?? 'entry';
      kinds[kind] = (kinds[kind] ?? 0) + 1;
      entries.set(node.repo, kinds);
    }
    if (UI_TYPES.has(node.type)) ui.set(node.repo, (ui.get(node.repo) ?? 0) + 1);
    if (node.type === 'consumer') consumers.set(node.repo, (consumers.get(node.repo) ?? 0) + 1);
  });

  const serviceNames = [...new Set([...input.services.map((service) => service.name), ...nodeCount.keys()])].sort();
  const reported = new Map(input.services.map((service) => [service.name, service]));
  const problems = new Map<string, number>();
  for (const row of input.rows) {
    if (row.level === 'action' && row.service) problems.set(row.service, (problems.get(row.service) ?? 0) + 1);
  }
  for (const name of serviceNames) {
    const kinds = entries.get(name) ?? {};
    const box = boxes[boxOf('service', name, roleOf(kinds, ui.get(name) ?? 0, consumers.get(name) ?? 0), anchors.get(name) ?? -1)] as MapBox;
    box.s = {
      nodes: nodeCount.get(name) ?? 0,
      ways: Object.values(kinds).reduce((sum, n) => sum + n, 0),
      problems: problems.get(name) ?? 0,
      ...(reported.get(name)?.skipped === undefined ? {} : { unread: 1 }),
      ...Object.fromEntries(Object.entries(kinds).map(([kind, n]) => ['e:' + kind, n])),
    };
  }

  // Which box owns each node.
  const tableUse = new Map<number, number>();
  for (const [from, to, type] of input.edges) {
    if (input.edgeTypes[type as number] === 'queries') tableUse.set(to as number, (tableUse.get(to as number) ?? 0) + 1);
  }
  const owner = input.nodes.map((node, i) => {
    if (node.type === 'channel') {
      const adapters = node.meta?.['adapters'];
      const family = Array.isArray(adapters) && typeof adapters[0] === 'string'
        ? adapters[0]
        : String(node.meta?.['channelKind'] ?? '');
      const at = boxOf('channel', node.label, 'channel', i);
      (boxes[at] as MapBox).g = family;
      return at;
    }
    if (node.type === 'table') return boxOf('data', node.repo, 'data');
    if (node.type === 'external_api') return boxOf('external', node.label, 'external', i);
    return boxOf('service', node.repo, 'library');
  });
  // A data box opens on its busiest table.
  input.nodes.forEach((node, i) => {
    if (node.type !== 'table') return;
    const box = boxes[owner[i] as number] as MapBox;
    const best = box.a < 0 ? -1 : (tableUse.get(box.a) ?? 0);
    if ((tableUse.get(i) ?? 0) > best) box.a = i;
    box.s['tables'] = (box.s['tables'] ?? 0) + 1;
  });

  // Links: every edge between two boxes, grouped by its two ends and its kind.
  const links: MapLink[] = [];
  const linkAt = new Map<string, number>();
  const rank = (confidence: number): number => {
    const at = CONFIDENCE_RANK.indexOf(input.confidences[confidence] ?? '');
    return at < 0 ? CONFIDENCE_RANK.length : at;
  };
  const neverCalled = new Set<number>();
  input.nodes.forEach((node, i) => {
    if (node.type === 'entry' && node.kind === 'http') neverCalled.add(i);
  });
  input.edges.forEach((edge, e) => {
    const [from, to, type, confidence] = edge as [number, number, number, number];
    const edgeType = input.edgeTypes[type] ?? '';
    if (edgeType === 'hits' || edgeType === 'http_calls') neverCalled.delete(to);
    if (NOT_A_LINK.has(edgeType)) return;
    const a = owner[from] as number;
    const b = owner[to] as number;
    if (a === b) return;
    const kind = linkKindOf(edgeType, input.nodes[to] as GraphNode);
    const key = `${a}>${b}>${kind}`;
    let at = linkAt.get(key);
    if (at === undefined) {
      links.push({ f: a, t: b, k: LINK_KINDS.indexOf(kind), n: 0, b: confidence, w: confidence, e: [] });
      at = links.length - 1;
      linkAt.set(key, at);
    }
    const link = links[at] as MapLink & { b: number; w: number; e: number[] };
    link.n += 1;
    link.e.push(e);
    if (rank(confidence) < rank(link.b)) link.b = confidence;
    if (rank(confidence) > rank(link.w)) link.w = confidence;
  });
  for (const i of neverCalled) {
    const box = boxes[owner[i] as number] as MapBox;
    box.s['uncalled'] = (box.s['uncalled'] ?? 0) + 1;
  }
  for (const link of links) {
    const from = boxes[link.f] as MapBox;
    const to = boxes[link.t] as MapBox;
    if (LINK_KINDS[link.k] !== 'message') continue;
    if (BOX_KINDS[to.k] === 'channel') to.s['producers'] = (to.s['producers'] ?? 0) + link.n;
    if (BOX_KINDS[from.k] === 'channel') from.s['consumers'] = (from.s['consumers'] ?? 0) + link.n;
  }
  for (const box of boxes) {
    if (BOX_KINDS[box.k] !== 'channel') continue;
    box.s['producers'] ??= 0;
    box.s['consumers'] ??= 0;
  }

  // The packages layer, from the manifests.
  const allPackages = new Set<string>();
  for (const service of input.services) {
    for (const name of [...(service.packages?.runtime ?? []), ...(service.packages?.dev ?? [])]) allPackages.add(name);
  }
  const packages = [...allPackages].sort();
  const packageAt = new Map(packages.map((name, i) => [name, i]));
  const publishedBy = new Map<string, string>();
  for (const service of input.services) {
    if (service.packages?.name !== undefined) publishedBy.set(service.packages.name, service.name);
  }
  const users = new Map<string, Array<{ service: string; dev: boolean }>>();
  const manifests: PackedMap['manifests'] = {};
  for (const service of [...input.services].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const manifest = service.packages;
    if (manifest === undefined) continue;
    const box = boxOf('service', service.name, 'library');
    manifests[box] = {
      ...(manifest.name === undefined ? {} : { name: manifest.name }),
      runtime: manifest.runtime.map((name) => packageAt.get(name) as number),
      dev: manifest.dev.map((name) => packageAt.get(name) as number),
    };
    for (const [list, dev] of [[manifest.runtime, false], [manifest.dev, true]] as const) {
      for (const name of list) {
        const publisher = publishedBy.get(name);
        if (publisher !== undefined && publisher !== service.name) {
          links.push({
            f: box, t: boxOf('service', publisher, 'library'), k: LINK_KINDS.indexOf('package'), n: 1,
            p: name, ...(dev ? { d: 1 as const } : {}),
          });
        } else if (publisher === undefined) {
          users.set(name, [...(users.get(name) ?? []), { service: service.name, dev }]);
        }
      }
    }
  }
  for (const [name, using] of [...users].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (using.length < 2) continue;
    const box = boxOf('package', name, 'package');
    (boxes[box] as MapBox).g = scopeOf(name);
    (boxes[box] as MapBox).s = { users: using.length };
    for (const { service, dev } of using) {
      links.push({
        f: boxOf('service', service, 'library'), t: box, k: LINK_KINDS.indexOf('package'), n: 1,
        ...(dev ? { d: 1 as const } : {}),
      });
    }
  }

  // Families of services in one column share a frame; channels by what
  // carries them; packages by their scope. A family of fewer than
  // `CLUSTER_MIN` is no family.
  COLUMNS.forEach((_, column) => {
    const members = boxes.filter((box) => box.c === column && BOX_KINDS[box.k] === 'service');
    clustersOf(members.map((box) => box.n)).forEach((cluster, i) => {
      (members[i] as MapBox).g = cluster;
    });
  });
  for (const kind of ['channel', 'package'] as const) {
    const sized = new Map<string, number>();
    for (const box of boxes) if (BOX_KINDS[box.k] === kind && box.g !== '') sized.set(box.g, (sized.get(box.g) ?? 0) + 1);
    for (const box of boxes) if (BOX_KINDS[box.k] === kind && (sized.get(box.g) ?? 0) < CLUSTER_MIN) box.g = '';
  }

  return { boxes, links, packages, manifests };
};
