import { CHANNEL_FORWARD_META, CHANNEL_PATTERN_META, type ChannelForward, type ChannelPattern, type GraphEdge, type GraphNode } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { joinChannelPatterns } from './pattern-link.js';

const channel = (name: string): GraphNode => ({ id: `channel:${name}`, type: 'channel', label: name, repo: 'loans' });

const consumer = (pattern: ChannelPattern, meta: Record<string, unknown> = {}): GraphNode => ({
  id: 'consumer:routing#rules.tf:aws_cloudwatch_event_target.digest',
  type: 'consumer',
  label: 'rule library-loan-activity',
  repo: 'routing',
  file: 'rules.tf',
  line: 40,
  meta: { [CHANNEL_PATTERN_META]: pattern, ...meta },
});

const loanEvents = (detailType: ChannelPattern['parts'][number]['filters']): ChannelPattern => ({
  parts: [
    { name: 'service', filters: [{ equals: 'eventbridge' }] },
    { name: 'bus', filters: [{ equals: 'library' }] },
    { name: 'source', filters: [{ equals: 'library.loans' }] },
    { name: 'detail-type', filters: detailType },
  ],
});

const join = (nodes: GraphNode[]) => {
  const edges = new Map<string, GraphEdge>();
  const rows = joinChannelPatterns(new Map(nodes.map((node) => [node.id, node])), edges);
  return { edges: [...edges.values()], rows };
};

describe('joinChannelPatterns', () => {
  const created = channel('eventbridge/library/library.loans/LoanCreated');
  const returned = channel('eventbridge/library/library.loans/LoanReturned');
  const elsewhere = channel('eventbridge/default/library.loans/LoanReturned');

  it('joins every channel the pattern selects, heuristic, with the reason and what was not matched on', () => {
    const rule = consumer(loanEvents([{ anythingBut: [{ equals: 'LoanCreated' }] }]), { notMatchedOn: ['detail'] });
    const { edges, rows } = join([created, returned, elsewhere, rule]);
    expect(rows).toEqual([]);
    expect(edges).toEqual([
      {
        from: returned.id,
        to: rule.id,
        type: 'consumes',
        confidence: 'heuristic',
        file: 'rules.tf',
        line: 40,
        meta: { via: 'pattern', because: ['detail-type "LoanReturned" matches anything but "LoanCreated"'], notMatchedOn: ['detail'] },
      },
    ]);
  });

  it('is static where every part is matched exactly, and heuristic again where the rule is disabled', () => {
    expect(join([created, consumer(loanEvents([{ equals: 'LoanCreated' }]))]).edges.map((edge) => edge.confidence)).toEqual(['static']);
    expect(
      join([created, consumer(loanEvents([{ equals: 'LoanCreated' }]), { disabled: true })]).edges.map((edge) => [edge.confidence, edge.meta?.['because']]),
    ).toEqual([['heuristic', ['the delivery is disabled']]]);
  });

  it('says once, at info, that a pattern selects nothing anybody publishes', () => {
    const { edges, rows } = join([elsewhere, consumer(loanEvents([]))]);
    expect(edges).toEqual([]);
    expect(rows).toEqual([expect.objectContaining({ reason: 'subscription-matches-nothing', level: 'info', service: 'routing' })]);
  });

  describe('a consumer that carries what it takes on to another bus', () => {
    const producer: GraphNode = { id: 'producer:routing#rules.tf:aws_cloudwatch_event_target.audit', type: 'producer', label: 'event', repo: 'routing', file: 'rules.tf', line: 40 };
    const forwarding = consumer(loanEvents([{ prefix: 'Loan' }]), {
      [CHANNEL_FORWARD_META]: { producer: producer.id, parts: [null, 'audit', null, null] } satisfies ChannelForward,
    });
    const auditRule: GraphNode = {
      ...consumer({
        parts: [
          { name: 'service', filters: [{ equals: 'eventbridge' }] },
          { name: 'bus', filters: [{ equals: 'audit' }] },
          { name: 'source', filters: [] },
          { name: 'detail-type', filters: [{ equals: 'LoanReturned' }] },
        ],
      }),
      id: 'consumer:audit#rules.tf:aws_cloudwatch_event_target.returns',
    };

    it('puts each matched channel on the other bus, at the confidence of the match, where a rule there matches it in turn', () => {
      const nodes = new Map([created, returned, producer, forwarding, auditRule].map((node) => [node.id, node]));
      const edges = new Map<string, GraphEdge>();
      const rows = joinChannelPatterns(nodes, edges);
      expect(rows).toEqual([]);
      const emitted = [...edges.values()].filter((edge) => edge.type === 'emits');
      expect(emitted.map((edge) => [edge.to, edge.confidence, edge.meta?.['forwardedFrom']])).toEqual([
        ['channel:eventbridge/audit/library.loans/LoanCreated', 'heuristic', created.id],
        ['channel:eventbridge/audit/library.loans/LoanReturned', 'heuristic', returned.id],
      ]);
      expect(nodes.get('channel:eventbridge/audit/library.loans/LoanReturned')).toMatchObject({ type: 'channel', repo: 'routing' });
      expect([...edges.values()].filter((edge) => edge.to === auditRule.id).map((edge) => edge.from)).toEqual([
        'channel:eventbridge/audit/library.loans/LoanReturned',
      ]);
    });

    it('ends when two buses forward to each other', () => {
      const back: GraphNode = {
        ...consumer(
          {
            parts: [
              { name: 'service', filters: [{ equals: 'eventbridge' }] },
              { name: 'bus', filters: [{ equals: 'audit' }] },
              { name: 'source', filters: [] },
              { name: 'detail-type', filters: [] },
            ],
          },
          { [CHANNEL_FORWARD_META]: { producer: producer.id, parts: [null, 'library', null, null] } },
        ),
        id: 'consumer:audit#rules.tf:aws_cloudwatch_event_target.back',
      };
      const nodes = new Map([created, producer, forwarding, back].map((node) => [node.id, node]));
      joinChannelPatterns(nodes, new Map());
      expect([...nodes.keys()].filter((id) => id.startsWith('channel:')).sort()).toEqual([
        'channel:eventbridge/audit/library.loans/LoanCreated',
        'channel:eventbridge/library/library.loans/LoanCreated',
      ]);
    });
  });
});
