import type { GraphNode } from '@flowatlas/core';
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
  /** Channels listed under each of the two lonely ends. */
  channels: number;
}

export const START_LIMITS: StartLimits = { perService: 3, gaps: 5, channels: 5 };

export interface ServiceCount {
  service: string;
  nodes: number;
  entries: number;
  entriesByKind: Record<string, number>;
  gaps: number;
}

export interface GapReason {
  reason: string;
  count: number;
  services: string[];
  /** The first place it was seen, so there is something to open. */
  example: { service?: string; loc?: string; message: string; id?: string };
}

export interface StartSummary {
  services: ServiceCount[];
  topGaps: GapReason[];
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

  const reasons = new Map<string, GapReason>();
  for (const row of input.unresolved) {
    if (row.level !== 'action' || !wanted(row.service)) continue;
    if (row.service !== null) counted(row.service).gaps += 1;
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
  const topGaps = [...reasons.values()]
    .sort((a, b) => b.count - a.count || cmp(a.reason, b.reason))
    .slice(0, limits.gaps)
    .map((gap) => ({ ...gap, services: [...gap.services].sort() }));

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
    topGaps,
    channels: {
      noConsumers: noConsumers.sort().slice(0, limits.channels),
      noProducers: noProducers.sort().slice(0, limits.channels),
    },
    startFrom,
  };
};
