import {
  GUESSED_META,
  isTaken,
  RECORDED_META,
  strongestTaken,
  TAKEN_BY_META,
  TAKES_META,
  type GraphEdge,
  type GraphNode,
  type Takes,
  type Unresolved,
} from '@flowatlas/core';
import { cmp } from './order.js';

/**
 * Asks of each publish onto a channel whose consumers take only some of it
 * whether any of them takes it (P52).
 *
 * A notification of a bucket takes objects created, or removed, under some
 * keys; a write is one kind of event under one key. Both are on the graph - the
 * kind and the key the write recorded on its publisher, what each consumer
 * takes on the consumer - and only the whole project has both, since the
 * writer and the deployment are often two repositories. The publisher's edge
 * onto the channel says which consumers take it, and stays `static` only where
 * one surely does; a write nothing takes is an `info` row, because the walk
 * through the channel would otherwise reach a reader that never sees it.
 *
 * A publisher that marks itself as a guess - a URL signed for somebody else to
 * write with - is a guess on every edge, here included those the environment
 * completed, whatever is taken.
 */

const takesOf = (node: GraphNode | undefined): Takes | undefined => node?.meta?.[TAKES_META] as Takes | undefined;

export const matchTakenPublishes = (nodes: ReadonlyMap<string, GraphNode>, edges: ReadonlyMap<string, GraphEdge>): Unresolved[] => {
  const takers = new Map<string, GraphNode[]>();
  for (const edge of edges.values()) {
    const consumer = nodes.get(edge.to);
    if (edge.type !== 'consumes' || takesOf(consumer) === undefined) continue;
    takers.set(edge.from, [...(takers.get(edge.from) ?? []), consumer as GraphNode]);
  }
  for (const edge of edges.values()) {
    const guessed = nodes.get(edge.from)?.meta?.[GUESSED_META];
    if (edge.type !== 'emits' || typeof guessed !== 'string') continue;
    const said = (edge.meta?.['because'] as string[] | undefined) ?? [];
    edge.confidence = 'heuristic';
    if (!said.includes(guessed)) edge.meta = { ...edge.meta, because: [...said, guessed] };
  }
  const rows: Unresolved[] = [];
  for (const edge of edges.values()) {
    const consumers = takers.get(edge.to);
    const producer = nodes.get(edge.from);
    if (edge.type !== 'emits' || consumers === undefined || producer?.type !== 'producer') continue;
    const kind = String(producer.meta?.['kind'] ?? '');
    const recorded = producer.meta?.[RECORDED_META] as Record<string, string[]> | undefined;
    const answers = consumers.map((consumer) => ({ consumer, answer: isTaken(kind, recorded, takesOf(consumer) as Takes) }));
    const taken = answers.filter(({ answer }) => answer.taken !== 'no');
    const best = strongestTaken(answers.map(({ answer }) => answer));
    const because = [
      ...(best.taken === 'heuristic' ? [best.because] : []),
      ...(best.taken === 'no' ? ['nothing on the channel takes it'] : []),
    ];
    if (because.length > 0) edge.confidence = 'heuristic';
    edge.meta = {
      ...edge.meta,
      [TAKEN_BY_META]: taken.map(({ consumer }) => consumer.id).sort(cmp),
      ...(because.length === 0 ? {} : { because: [...((edge.meta?.['because'] as string[] | undefined) ?? []), ...because] }),
    };
    if (best.taken !== 'no') continue;
    const channel = nodes.get(edge.to);
    rows.push({
      service: producer.repo,
      file: producer.file ?? '',
      line: producer.line ?? 0,
      reason: 's3-write-matches-nothing',
      level: 'info',
      message: `the call at ${producer.file ?? '?'}:${producer.line ?? '?'} is ${kind} on ${channel?.label ?? edge.to}, and none of its ${consumers.length} notification(s) takes it`,
      hint: 'Each notification takes some events and, where it filters, keys with a given start and end. Nothing to fix if the write is meant to notify nobody.',
      symbol: producer.id,
      meta: { notifications: consumers.map((consumer) => consumer.label).sort(cmp) },
    });
  }
  return rows;
};
