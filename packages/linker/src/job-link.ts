import type { GraphEdge, GraphNode, Unresolved } from '@flowatlas/core';
import { cmp } from './order.js';

/**
 * Asks of each job added to a queue whether a handler of that queue takes
 * it (P271).
 *
 * A queue's handlers are of two kinds: a worker that takes every job of its
 * queue, and a handler that names the one job it takes - `@Process('send')`.
 * Where every handler of a queue names its job, a job added by a name none of
 * them names is taken by nothing: the library keeps it waiting, or fails it,
 * and nothing in either end says so. Producer and handler are often in two
 * services, so this is asked once every repository is merged.
 *
 * Quiet wherever the answer is not certain: a queue with a handler that
 * names no job, a producer whose job is not read, a queue nothing handles.
 * The reverse - a handler of a job nothing adds - is not asked: a job is
 * also added by a schedule, a script, an operator or another system, which
 * the graph cannot see, so its absence says nothing.
 */

/** The jobs a producer adds, as it names them: one, several, or none it could read. */
const jobsOf = (producer: GraphNode): string[] => {
  const several = producer.meta?.['jobNames'];
  if (Array.isArray(several)) return several.filter((name): name is string => typeof name === 'string');
  const one = producer.meta?.['jobName'];
  return typeof one === 'string' ? [one] : [];
};

export const jobsWithoutHandler = (nodes: ReadonlyMap<string, GraphNode>, edges: ReadonlyMap<string, GraphEdge>): Unresolved[] => {
  const handlers = new Map<string, GraphNode[]>();
  const senders = new Map<string, GraphNode[]>();
  for (const edge of edges.values()) {
    if (edge.type === 'consumes') {
      const consumer = nodes.get(edge.to);
      if (consumer?.type === 'consumer') handlers.set(edge.from, [...(handlers.get(edge.from) ?? []), consumer]);
    } else if (edge.type === 'emits') {
      const producer = nodes.get(edge.from);
      if (producer?.type === 'producer') senders.set(edge.to, [...(senders.get(edge.to) ?? []), producer]);
    }
  }
  const rows: Unresolved[] = [];
  for (const [channelId, consumers] of [...handlers].sort(([a], [b]) => cmp(a, b))) {
    // A handler naming no job takes them all, and one is enough.
    if (consumers.some((consumer) => typeof consumer.meta?.['jobName'] !== 'string')) continue;
    const taken = new Set(consumers.map((consumer) => consumer.meta?.['jobName'] as string));
    const channel = nodes.get(channelId);
    const seen = new Set<string>();
    for (const producer of senders.get(channelId) ?? []) {
      for (const job of jobsOf(producer)) {
        const key = `${producer.id}|${job}`;
        if (taken.has(job) || seen.has(key)) continue;
        seen.add(key);
        rows.push({
          service: producer.repo,
          file: producer.file ?? '',
          line: producer.line ?? 0,
          reason: 'job-no-handler',
          level: 'info',
          message: `the call at ${producer.file ?? '?'}:${producer.line ?? '?'} adds the job ${job} to ${channel?.label ?? channelId}, and none of its ${consumers.length} handler(s) takes that job`,
          hint:
            'Every handler of this queue names the one job it takes, and none names this one, so nothing runs it. ' +
            'Add a handler for it, or add it under the name a handler takes. Nothing to fix if a handler is in a repository the configuration does not name.',
          symbol: producer.id,
          meta: { job, queue: channel?.label ?? channelId, handled: [...taken].sort(cmp) },
        });
      }
    }
  }
  return rows;
};
