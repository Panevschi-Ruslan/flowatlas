import { EVERY_CHANNEL_META, type GraphEdge, type GraphNode } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { edgeKey } from './order.js';
import { joinEveryChannel } from './every-channel-link.js';

const channel = (name: string, repo = 'shop'): GraphNode => ({ id: `channel:${name}`, type: 'channel', label: name, repo });
const producer = (at: string, repo = 'shop', adapter = 'shop-bus'): GraphNode => ({ id: `producer:${repo}#${at}`, type: 'producer', label: at, repo, meta: { adapter } });
const emits = (from: GraphNode, to: GraphNode): GraphEdge => ({ from: from.id, to: to.id, type: 'emits', confidence: 'static' });

const subscriber = (repo = 'shop'): GraphNode => ({
  id: `consumer:${repo}#src/notify.ts:Notify.start`,
  type: 'consumer',
  label: 'Notify.start',
  repo,
  file: 'src/notify.ts',
  line: 12,
  meta: { [EVERY_CHANNEL_META]: 'shop-bus' },
});

const join = (nodes: GraphNode[], given: GraphEdge[]) => {
  const edges = new Map<string, GraphEdge>(given.map((edge) => [edgeKey(edge), edge]));
  const rows = joinEveryChannel(new Map(nodes.map((node) => [node.id, node])), edges);
  return { consumes: [...edges.values()].filter((edge) => edge.type === 'consumes'), rows };
};

describe('joinEveryChannel (P369)', () => {
  const orders = channel('orders');
  const desks = channel('desks');
  const audit = channel('audit');
  const typed: GraphNode = { id: 'channel:orders#READY', type: 'channel', label: 'orders#READY', repo: 'shop', kind: 'message_type' };
  const placed = producer('src/orders.ts:10:5');
  const helped = producer('src/desks.ts:8:5');
  const elsewhere = producer('src/audit.ts:4:5', 'bot');
  const otherBus = producer('src/audit.ts:9:5', 'shop', 'redis');

  it('joins the subscriber to every channel a publish through its bus writes to, in its service', () => {
    const { consumes, rows } = join(
      [orders, desks, audit, typed, placed, helped, elsewhere, otherBus, subscriber()],
      [emits(placed, orders), emits(placed, typed), emits(helped, desks), emits(elsewhere, audit), emits(otherBus, audit)],
    );
    expect(rows).toEqual([]);
    expect(consumes.map((edge) => `${edge.from}:${edge.confidence}:${String(edge.meta?.['via'])}`)).toEqual([
      'channel:desks:static:every-channel',
      'channel:orders:static:every-channel',
    ]);
  });

  it('says so where the bus carries nothing read in the service', () => {
    const { consumes, rows } = join([orders, elsewhere, subscriber()], [emits(elsewhere, orders)]);
    expect(consumes).toEqual([]);
    expect(rows.map((row) => `${row.reason}:${row.level}`)).toEqual(['subscription-matches-nothing:info']);
    expect(rows[0]?.message).toContain('every channel of shop-bus');
  });
});
