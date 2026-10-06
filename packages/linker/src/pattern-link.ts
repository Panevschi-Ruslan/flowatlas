import {
  CHANNEL_PATTERN_META,
  matchChannelPattern,
  type ChannelPattern,
  type GraphEdge,
  type GraphNode,
  type Unresolved,
} from '@flowatlas/core';
import { cmp, edgeKey } from './order.js';

/**
 * Joins a consumer that takes its channels by a filter to every channel the
 * filter selects (P23).
 *
 * A rule on an event bus is a filter, not a name: it takes every event whose
 * source starts with `library.`, or every detail type of one source. Its
 * channels are therefore whichever channels the project's publishers name,
 * which only the whole project knows. Each channel whose name the filter
 * matches gets a `consumes` edge, `static` only where every part matched an
 * exact value - the same join two names make - and `heuristic` otherwise, with
 * the reason on the edge. A filter that selects nothing anybody publishes is
 * a way in from outside the project, not a fault: one `info` row says so.
 */

const CHANNEL_PREFIX = 'channel:';

export const joinChannelPatterns = (nodes: ReadonlyMap<string, GraphNode>, edges: Map<string, GraphEdge>): Unresolved[] => {
  const channels = [...nodes.values()].filter((node) => node.type === 'channel').sort((a, b) => cmp(a.id, b.id));
  const consumers = [...nodes.values()]
    .filter((node) => node.type === 'consumer' && node.meta?.[CHANNEL_PATTERN_META] !== undefined)
    .sort((a, b) => cmp(a.id, b.id));
  const findings: Unresolved[] = [];
  for (const consumer of consumers) {
    const pattern = consumer.meta?.[CHANNEL_PATTERN_META] as ChannelPattern;
    const disabled = consumer.meta?.['disabled'] === true;
    const skipped = consumer.meta?.['notMatchedOn'];
    let matched = 0;
    for (const channel of channels) {
      const match = matchChannelPattern(channel.id.slice(CHANNEL_PREFIX.length), pattern);
      if (match === undefined) continue;
      matched += 1;
      const because = [...match.because, ...(disabled ? ['the delivery is disabled'] : [])];
      const edge: GraphEdge = {
        from: channel.id,
        to: consumer.id,
        type: 'consumes',
        confidence: match.exact && !disabled ? 'static' : 'heuristic',
        ...(consumer.file === undefined ? {} : { file: consumer.file }),
        ...(consumer.line === undefined ? {} : { line: consumer.line }),
        meta: {
          via: 'pattern',
          ...(because.length === 0 ? {} : { because }),
          ...(Array.isArray(skipped) && skipped.length > 0 ? { notMatchedOn: skipped } : {}),
        },
      };
      if (!edges.has(edgeKey(edge))) edges.set(edgeKey(edge), edge);
    }
    if (matched > 0) continue;
    findings.push({
      service: consumer.repo,
      file: consumer.file ?? '',
      line: consumer.line ?? 0,
      reason: 'subscription-matches-nothing',
      level: 'info',
      message: `${consumer.label} takes events by a pattern that no publisher in the configured services matches`,
      hint: 'A rule for events nothing here puts is a way in from outside - another account, a partner, the platform itself - or its publisher is in a repository the configuration does not name. Nothing to fix if it is the first.',
      symbol: consumer.id,
    });
  }
  return findings;
};
