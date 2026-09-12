import { describe, expect, it } from 'vitest';
import { checkContracts } from './check.js';
import { createContractChecker } from './mcp-hook.js';
import { edge, field, graphOf, node, object } from './test-graph.js';

/**
 * The half of `check_contract` the server cannot answer on its own.
 *
 * The server can say whether two hashes agree. Which field disagrees is the
 * only part of that answer an agent can act on, and it comes from here.
 */

const graph = graphOf({
  nodes: [
    node('http_out:caller#1', 'http_out', 'caller'),
    node('entry:api:http:POST:/orders', 'entry', 'api', { kind: 'http' }),
    node('api#Controller.create', 'method', 'api'),
    node('producer:api#1', 'producer', 'api'),
    node('channel:order.created', 'channel', 'api'),
    node('consumer:billing#1', 'consumer', 'billing'),
    node('billing#Consumer.on', 'method', 'billing'),
    node('entry:billing:event:order.created', 'entry', 'billing', { kind: 'event' }),
  ],
  edges: [
    edge('http_out:caller#1', 'http_calls', 'entry:api:http:POST:/orders', {
      params: ['type:caller#Body'],
    }),
    edge('entry:api:http:POST:/orders', 'handles', 'api#Controller.create', {
      meta: { body: 'type:api#Body' },
    }),
    edge('producer:api#1', 'emits', 'channel:order.created', { params: ['type:caller#Body'] }),
    edge('channel:order.created', 'consumes', 'consumer:billing#1'),
    edge('consumer:billing#1', 'handles', 'billing#Consumer.on'),
    edge('entry:billing:event:order.created', 'handles', 'billing#Consumer.on', {
      params: ['type:api#Body'],
    }),
  ],
  types: {
    'type:caller#Body': object('Body', [field('id', 'string')]),
    'type:api#Body': object('Body', [field('id', 'string'), field('channel', 'string')]),
  },
});

describe('the hook the server is handed', () => {
  const ask = createContractChecker(graph);

  it('answers with the same findings the report has for that edge', () => {
    const report = checkContracts(graph);
    const found = ask({
      edge: { from: 'http_out:caller#1', to: 'entry:api:http:POST:/orders', type: 'http_calls' },
    });
    expect(found).toEqual(
      report.findings.filter((finding) => finding.edge.from === 'http_out:caller#1'),
    );
  });

  it('carries the words the server already answers in', () => {
    const [finding] = ask({
      edge: { from: 'http_out:caller#1', to: 'entry:api:http:POST:/orders', type: 'http_calls' },
    });
    expect(finding?.kind).toBe('missing_required');
    expect(finding?.field).toBe('channel');
    expect(finding?.message).toContain('receiver api requires');
  });

  it('answers about a publisher asked about by the channel it publishes to', () => {
    // The contract is between the publisher and the handler; the edge a person
    // has in front of them points at the channel.
    const found = ask({
      edge: { from: 'producer:api#1', to: 'channel:order.created', type: 'emits' },
    });
    expect(found.map((finding) => finding.field)).toEqual(['channel']);
  });

  it('answers nothing for an edge that is not a boundary', () => {
    expect(ask({ edge: { from: 'a', to: 'b', type: 'calls' } })).toEqual([]);
  });
});
