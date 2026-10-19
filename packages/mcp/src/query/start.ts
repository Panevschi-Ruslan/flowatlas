import { countsOf, rowKindOf, type GraphNode } from '@flowatlas/core';
import type { AnchoredUnresolvedRow } from '@flowatlas/linker';
import { projectDetail } from './detail.js';
import type { CompactNode } from './types.js';

/**
 * The first answer of a session: how big each service is, what the reading
 * could not follow, and the ids to start from.
 *
 * Pure over rows already read, so the bound is visible here rather than spread
 * over queries: a few ids per service, a few gap reasons, a few channels.
 */

export interface StartLimits {
  /** Ids to start from, per service. */
  perService: number;
  /** Gap reasons listed. */
  gaps: number;
  /** Finding reasons listed (P94). */
  findings: number;
  /** Channels listed under each of the two lonely ends. */
  channels: number;
}

export const START_LIMITS: StartLimits = { perService: 3, gaps: 5, findings: 5, channels: 5 };

export interface ServiceCount {
  service: string;
  nodes: number;
  entries: number;
  entriesByKind: Record<string, number>;
  /** Actionable gap rows of this service. */
  gaps: number;
}

export interface GapReason {
  reason: string;
  count: number;
  services: string[];
  /** The first place it was seen, so there is something to open. */
  example: { service?: string; loc?: string; message: string; id?: string };
}

/**
 * The unresolved rows by kind, by the counter the build line, doctor and the
 * page use (P81), so one database says one set of numbers everywhere.
 */
export interface StartCounts {
  /** Gap rows that say something was not read: the build line's `missed`. */
  gaps: number;
  /** Places those rows stand for. */
  sites: number;
  /** Rows saying how a join or a reading was made, with nothing missed. */
  notes: number;
  /** Rows saying something about the code itself: a likely N+1, a route with no guard. */
  findings: number;
  /** Places with no edge to draw. */
  nothing: number;
}

export interface StartSummary {
  services: ServiceCount[];
  counts: StartCounts;
  /** The most common actionable gaps: places the reading could not follow, and only those. */
  topGaps: GapReason[];
  /**
   * The most common findings (P94): what the reading found about the code - a
   * likely N+1, a route with no guard - listed apart from the gaps, since
   * neither is a place the reading missed. Notes are counted and listed in none.
   */
  topFindings: GapReason[];
  channels: { noConsumers: string[]; noProducers: string[] };
  startFrom: CompactNode[];
}

export interface StartInput {
  nodes: readonly GraphNode[];
  /** The services each channel is published from and handled by. */
  channelEnds: ReadonlyMap<string, { producers: readonly string[]; consumers: readonly string[] }>;
  unresolved: readonly AnchoredUnresolvedRow[];
  service?: string;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The kinds a person most often starts from come first. */
const KIND_ORDER: ReadonlyMap<string, number> = new Map([
  ['http', 0],
  ['rpc', 1],
  ['event', 2],
  ['workflow', 3],
  ['invoke', 4],
  ['cron', 5],
]);

const kindRank = (node: GraphNode): number => KIND_ORDER.get(node.kind ?? '') ?? KIND_ORDER.size;

const bump = (counts: Record<string, number>, key: string): void => {
  counts[key] = (counts[key] ?? 0) + 1;
};

/** Rows by reason, most rows first, each with the services it is in and the first place it was seen. */
const topReasons = (rows: readonly AnchoredUnresolvedRow[], limit: number): GapReason[] => {
  const reasons = new Map<string, GapReason>();
  for (const row of rows) {
    const known = reasons.get(row.reason);
    if (known === undefined) {
      reasons.set(row.reason, {
        reason: row.reason,
        count: 1,
        services: row.service === null ? [] : [row.service],
        example: {
          message: row.message,
          ...(row.service === null ? {} : { service: row.service }),
          ...(row.file === null ? {} : { loc: row.line === null ? row.file : `${row.file}:${row.line}` }),
          ...(row.node === null ? {} : { id: row.node }),
        },
      });
      continue;
    }
    known.count += 1;
    if (row.service !== null && !known.services.includes(row.service)) known.services.push(row.service);
  }
  return [...reasons.values()]
    .sort((a, b) => b.count - a.count || cmp(a.reason, b.reason))
    .slice(0, limit)
    .map((reason) => ({ ...reason, services: [...reason.services].sort() }));
};

export const summariseProject = (input: StartInput, limits: StartLimits = START_LIMITS): StartSummary => {
  const wanted = (repo: string | null | undefined): boolean => input.service === undefined || repo === input.service;
  const byService = new Map<string, ServiceCount>();
  const counted = (service: string): ServiceCount => {
    let found = byService.get(service);
    if (found === undefined) {
      found = { service, nodes: 0, entries: 0, entriesByKind: {}, gaps: 0 };
      byService.set(service, found);
    }
    return found;
  };

  const entries: GraphNode[] = [];
  for (const node of input.nodes) {
    if (node.repo === '' || !wanted(node.repo)) continue;
    const count = counted(node.repo);
    count.nodes += 1;
    if (node.type !== 'entry') continue;
    count.entries += 1;
    bump(count.entriesByKind, node.kind ?? 'other');
    entries.push(node);
  }

  const inScope = input.unresolved.filter((row) => wanted(row.service));
  const { missed, sites, notes, findings, nothing } = countsOf(inScope);

  const actionable = inScope.filter((row) => row.level === 'action' && rowKindOf(row) === 'gap');
  for (const row of actionable) if (row.service !== null) counted(row.service).gaps += 1;
  const topGaps = topReasons(actionable, limits.gaps);
  // Every finding but one with nothing to point at, whatever its level: a
  // likely N+1 is written at `info` and is as much a finding as an unguarded route.
  const topFindings = topReasons(
    inScope.filter((row) => row.level !== 'nothing' && rowKindOf(row) === 'finding'),
    limits.findings,
  );

  const noConsumers: string[] = [];
  const noProducers: string[] = [];
  for (const node of input.nodes) {
    if (node.type !== 'channel') continue;
    const ends = input.channelEnds.get(node.id) ?? { producers: [], consumers: [] };
    if (!ends.producers.some(wanted) && !ends.consumers.some(wanted)) continue;
    if (ends.consumers.length === 0) noConsumers.push(node.id);
    if (ends.producers.length === 0) noProducers.push(node.id);
  }

  const perService = new Map<string, number>();
  const startFrom = entries
    .sort((a, b) => cmp(a.repo, b.repo) || kindRank(a) - kindRank(b) || cmp(a.id, b.id))
    .filter((node) => {
      const used = perService.get(node.repo) ?? 0;
      perService.set(node.repo, used + 1);
      return used < limits.perService;
    })
    .map((node) => projectDetail(node, 1));

  return {
    services: [...byService.values()].sort((a, b) => cmp(a.service, b.service)),
    counts: { gaps: missed, sites, notes, findings, nothing },
    topGaps,
    topFindings,
    channels: {
      noConsumers: noConsumers.sort().slice(0, limits.channels),
      noProducers: noProducers.sort().slice(0, limits.channels),
    },
    startFrom,
  };
};
