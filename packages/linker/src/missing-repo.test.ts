import type { GraphEdge, GraphNode } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import {
  channelToken,
  missingByGap,
  missingKeyOf,
  missingRepoSignals,
  missingTokenOfGap,
  rankMissing,
  saySeen,
  saySignal,
  subscriptionSources,
  worthSaying,
  type MissingRow,
} from './missing-repo.js';

const call = (id: string, repo: string, meta: Record<string, unknown>, line = 10): GraphNode => ({
  id,
  type: 'http_out',
  label: 'POST /charges',
  repo,
  file: 'src/pay.ts',
  line,
  meta,
});

const unclaimed = (symbol: string, env: string, line = 10, service = 'gateway'): MissingRow => ({
  reason: 'unknown-base-url-env',
  service,
  file: 'src/pay.ts',
  line,
  symbol,
  message: `no service declares ${env}`,
});

const SERVICES = [
  { name: 'gateway', packageName: '@acme/gateway' },
  { name: 'orders', packageName: '@acme/orders' },
];
const REPORT = {
  channels: { noConsumers: [] as string[], noProducers: [] as string[] },
  services: [
    { name: 'gateway', packages: { name: '@acme/gateway', runtime: [], dev: [] } },
    { name: 'orders', packages: { name: '@acme/orders', runtime: [], dev: [] } },
  ],
} as never;

describe('missingKeyOf', () => {
  it('reads one name out of every way it is written', () => {
    for (const name of ['PAYMENTS_URL', 'paymentsApi', 'payments-api', 'payment', 'payments-client', 'PAYMENTS_SERVICE_BASE_URL']) {
      expect(missingKeyOf(name), name).toBe('payment');
    }
    expect(missingKeyOf('libraries')).toBe('library');
    expect(missingKeyOf('API_URL')).toBe('');
    expect(missingKeyOf('localhost:4000')).toBe('localhost:4000');
  });
});

describe('missingRepoSignals', () => {
  it('reads a setting nobody claims, and the inner hosts of its values', () => {
    const node = call('http_out:gateway#a', 'gateway', { baseUrlEnv: 'PAYMENTS_URL', baseUrlValues: ['http://payments:4000', 'https://api.example-pay.com'] });
    const signals = missingRepoSignals({ nodes: [node], unresolved: [unclaimed(node.id, 'PAYMENTS_URL')] }, REPORT);
    expect(signals.map((signal) => [signal.kind, signal.name, signal.token])).toEqual([
      ['host', 'payments:4000', 'payments'],
      ['setting', 'PAYMENTS_URL', 'payments'],
    ]);
    expect(signals[1]?.places).toEqual([{ service: 'gateway', file: 'src/pay.ts', line: 10, gapId: 'gap:gateway|src/pay.ts|unknown-base-url-env' }]);
  });

  it('leaves a setting two services claim alone', () => {
    const row = { ...unclaimed('x', 'PAYMENTS_URL'), message: 'PAYMENTS_URL is declared on services a and b' };
    expect(missingRepoSignals({ nodes: [], unresolved: [row] }, REPORT)).toEqual([]);
  });

  it('takes an inner host for one, and a third party for none', () => {
    const nodes: GraphNode[] = [
      { id: 'external_api:payments.internal', type: 'external_api', label: 'payments.internal', repo: 'gateway', meta: { host: 'payments.internal' } },
      { id: 'external_api:api.stripe.com', type: 'external_api', label: 'api.stripe.com', repo: 'gateway', meta: { host: 'api.stripe.com' } },
      { id: 'external_api:ledger.shop.example.com', type: 'external_api', label: 'ledger.shop.example.com', repo: 'gateway', meta: { host: 'ledger.shop.example.com' } },
      call('http_out:gateway#b', 'gateway', { host: 'payments.internal' }, 12),
    ];
    const tokens = (services: Parameters<typeof missingRepoSignals>[0]['services']) =>
      missingRepoSignals({ nodes, unresolved: [], ...(services === undefined ? {} : { services }) }, REPORT).map((signal) => signal.token);
    expect(tokens(undefined)).toEqual(['payments']);
    // A domain a configured service is reached under is the project's own.
    expect(tokens([{ name: 'orders', hosts: ['orders.shop.example.com'] }])).toEqual(['ledger', 'payments']);
  });

  it('reads a package under the project scope that nobody installed, and not a public one', () => {
    const row: MissingRow = {
      reason: 'type-unresolved',
      service: 'orders',
      file: 'src/o.ts',
      line: 3,
      meta: {
        causes: [
          { cause: 'module-not-installed', package: '@acme/payments-client', sites: 2, samples: [{ file: 'src/o.ts', line: 3 }, { file: 'src/p.ts', line: 9 }] },
          { cause: 'module-not-installed', package: '@nestjs/common', sites: 1, samples: [{ file: 'src/o.ts', line: 1 }] },
          { cause: 'module-not-installed', package: '@acme/orders', sites: 1, samples: [{ file: 'src/o.ts', line: 2 }] },
        ],
      },
    };
    const signals = missingRepoSignals({ nodes: [], unresolved: [row] }, REPORT);
    expect(signals.map((signal) => [signal.kind, signal.name, signal.token, signal.places.length])).toEqual([
      ['package', '@acme/payments-client', 'payments', 2],
    ]);
  });

  it('reads a channel with one end by its first segment, its transport left off', () => {
    const channel: GraphNode = { id: 'channel:payment.requested', type: 'channel', label: 'payment.requested', repo: 'orders', meta: {} };
    const queue: GraphNode = { id: 'channel:sqs/ledger-audit', type: 'channel', label: 'sqs/ledger-audit', repo: 'orders', meta: { adapters: ['aws-sqs'] } };
    const producer: GraphNode = { id: 'producer:orders#x', type: 'producer', label: 'emit', repo: 'orders', file: 'src/o.ts', line: 7 };
    const edges: GraphEdge[] = [{ from: producer.id, to: channel.id, type: 'emits', confidence: 'static' }];
    const report = { ...(REPORT as object), channels: { noConsumers: [channel.id], noProducers: [queue.id] } } as never;
    const signals = missingRepoSignals({ nodes: [channel, queue, producer], edges, unresolved: [] }, report);
    expect(signals.map((signal) => [signal.name, signal.token, signal.lacks])).toEqual([
      ['payment.requested', 'payment', 'consumer'],
      ['sqs/ledger-audit', 'ledger-audit', 'producer'],
    ]);
    expect(signals[0]?.places).toEqual([{ service: 'orders', file: 'src/o.ts', line: 7 }]);
    expect(saySignal(signals[0] as never)).toBe('channel payment.requested is published by orders and nobody here consumes it');
    expect(channelToken({ label: 'eventbridge/shop/orders.placed', meta: { adapters: ['aws-eventbridge'] } })).toBe('shop');
  });

  it('reads a deployment that starts something nobody deploys, by its service part', () => {
    const entry: GraphNode = { id: 'entry:infra:http:POST:/charges', type: 'entry', label: 'POST /charges', repo: 'infra', meta: { invokes: 'payments-charge-prod' } };
    const row: MissingRow = {
      reason: 'invoke-target-not-found',
      service: 'infra',
      file: 'api.tf',
      line: 4,
      symbol: entry.id,
      message: 'POST /charges is answered by the function payments-charge-prod, which no configured service deploys',
    };
    const signals = missingRepoSignals({ nodes: [entry], unresolved: [row] }, REPORT);
    expect(signals.map((signal) => [signal.kind, signal.token])).toEqual([['deployment', 'payments']]);
  });

  it('never reads a route missing from a configured service as a repository', () => {
    const row: MissingRow = { reason: 'target-route-not-found', service: 'gateway', file: 'a.ts', line: 1, message: 'target service orders has no route' };
    expect(missingRepoSignals({ nodes: [], unresolved: [row] }, REPORT)).toEqual([]);
  });
});

describe('rankMissing', () => {
  const node = call('http_out:gateway#a', 'gateway', { baseUrlEnv: 'PAYMENTS_URL' });
  const other = call('http_out:gateway#c', 'gateway', { baseUrlEnv: 'SEARCH_URL' }, 20);
  const second = call('http_out:gateway#d', 'gateway', { baseUrlEnv: 'SEARCH_URL' }, 30);
  const channel: GraphNode = { id: 'channel:payment.requested', type: 'channel', label: 'payment.requested', repo: 'orders', file: 'src/o.ts', line: 7 };
  const signals = missingRepoSignals(
    {
      nodes: [node, other, second, channel],
      unresolved: [unclaimed(node.id, 'PAYMENTS_URL'), unclaimed(other.id, 'SEARCH_URL', 20), unclaimed(second.id, 'SEARCH_URL', 30)],
    },
    { ...(REPORT as object), channels: { noConsumers: [channel.id], noProducers: [] } } as never,
  );

  it('ranks kinds of evidence above places', () => {
    const groups = rankMissing(signals, SERVICES);
    expect(groups.map((group) => [group.token, group.score, group.places, group.kinds])).toEqual([
      ['payments', 2, 2, ['setting', 'channel']],
      ['search', 1, 2, ['setting']],
    ]);
    expect(rankMissing(signals, SERVICES, { top: 1 })).toHaveLength(1);
  });

  it('drops a name that is a configured service, by name, alias, host or package', () => {
    for (const service of [{ name: 'payments' }, { name: 'billing', aliases: ['payments-api'] }, { name: 'billing', hosts: ['payments.internal:80'] }, { name: 'billing', packageName: '@acme/payment' }]) {
      expect(rankMissing(signals, [service]).map((group) => group.token), JSON.stringify(service)).toEqual(['search']);
    }
  });

  it('says a lone channel or package only when asked for everything', () => {
    expect(worthSaying({ kinds: ['channel'] })).toBe(false);
    expect(worthSaying({ kinds: ['package'] }, 1)).toBe(true);
    expect(worthSaying({ kinds: ['package', 'channel'] })).toBe(true);
    expect(worthSaying({ kinds: ['setting'] })).toBe(true);
  });
});

describe('traffic from a service nobody configured (P144)', () => {
  /** A blind-spot row as P110's `blindSpotRows` writes one: file-less, the group under `meta.seen`. */
  const blind = (service: string, kind: string, names: Array<[string, number]>): MissingRow => ({
    reason: 'seen-not-in-code',
    service,
    file: '',
    line: 0,
    message: `traffic in ${service} reached ...`,
    sites: names.length,
    meta: {
      seen: { service, kind, count: names.reduce((sum, [, count]) => sum + count, 0), places: names.length, lastSeen: null, names: names.map(([name, count]) => ({ name, count, lastSeen: null })), next: [] },
      window: '2h',
    },
  });
  const routes = blind('payments', 'http', [['POST /charges', 3], ['POST /refunds', 1]]);
  const methods = blind('payments', 'code', [['ChargesController.charge', 3]]);

  it('reads a blind spot of an unlisted service as traffic, one place per kind, each with what it reached', () => {
    const [signal, ...rest] = missingRepoSignals({ nodes: [], unresolved: [routes, methods] }, REPORT);
    expect(rest).toEqual([]);
    expect([signal?.kind, signal?.name, signal?.token]).toEqual(['traffic', 'payments', 'payments']);
    expect(signal?.places).toEqual([
      { service: 'payments', gapId: 'gap:payments||seen-not-in-code', seen: { kind: 'http', places: 2, count: 4, names: ['POST /charges', 'POST /refunds'], window: '2h' } },
      { service: 'payments', gapId: 'gap:payments||seen-not-in-code', seen: { kind: 'code', places: 1, count: 3, names: ['ChargesController.charge'], window: '2h' } },
    ]);
    expect(saySignal(signal!)).toBe('traffic came from payments, which no configured service is: 2 routes and 1 method, 7 spans in 2h');
    expect(saySeen(signal!.places[0]!.seen!)).toBe('2 routes, 4 spans in 2h: POST /charges, POST /refunds');
  });

  it("never reads a configured service's blind spots, nor a row that carries no group", () => {
    const configured = blind('gateway', 'http', [['GET /healthz', 1]]);
    const bare: MissingRow = { reason: 'seen-not-in-code', service: 'payments', file: '', line: 0, message: 'traffic' };
    expect(missingRepoSignals({ nodes: [], unresolved: [configured, bare] }, REPORT)).toEqual([]);
    // A service the configuration lists without a report of it yet (doctor's names) is configured too.
    expect(missingRepoSignals({ nodes: [], unresolved: [routes], services: [{ name: 'payments' }] }, REPORT)).toEqual([]);
  });

  it('is one kind among the others, weak alone and worth saying once another kind agrees (D1)', () => {
    const node = call('http_out:gateway#a', 'gateway', { baseUrlEnv: 'PAYMENTS_URL' });
    const alone = rankMissing(missingRepoSignals({ nodes: [], unresolved: [routes, methods] }, REPORT), SERVICES);
    expect(alone.map((group) => [group.token, group.score, group.places, group.kinds])).toEqual([['payments', 1, 2, ['traffic']]]);
    expect(worthSaying(alone[0]!)).toBe(false);
    expect(worthSaying(alone[0]!, 1)).toBe(true);
    const agreed = rankMissing(missingRepoSignals({ nodes: [node], unresolved: [unclaimed(node.id, 'PAYMENTS_URL'), routes] }, REPORT), SERVICES);
    expect(agreed.map((group) => [group.token, group.score, group.kinds])).toEqual([['payments', 2, ['setting', 'traffic']]]);
    expect(worthSaying(agreed[0]!)).toBe(true);
    // A service that names itself as a configured one does, generic words and all, is a join problem.
    expect(rankMissing(missingRepoSignals({ nodes: [], unresolved: [blind('orders-api', 'http', [['GET /x', 1]])] }, REPORT), SERVICES)).toEqual([]);
  });

  it('hands the gap of the blind spots to the group, so its check names the repository', () => {
    const groups = rankMissing(missingRepoSignals({ nodes: [], unresolved: [routes] }, REPORT), SERVICES);
    expect(missingTokenOfGap(missingByGap(groups), 'gap:payments||seen-not-in-code')).toBe('payments');
  });

  describe('calls whose peer.service names it (P146)', () => {
    const fromGateway = blind('gateway', 'peer', [['payments-api', 6], [':value', 1]]);
    const fromOrders = blind('orders', 'peer', [['payments', 1]]);

    it('reads each peer a configured service called as traffic to that name, by caller, a masked name left out', () => {
      const signals = missingRepoSignals({ nodes: [], unresolved: [fromGateway, fromOrders] }, REPORT);
      expect(signals.map((signal) => [signal.kind, signal.name, signal.token])).toEqual([
        ['traffic', 'payments', 'payments'],
        ['traffic', 'payments-api', 'payments'],
      ]);
      const api = signals[1]!;
      expect(api.places).toEqual([
        { service: 'gateway', gapId: 'gap:gateway||seen-not-in-code', seen: { kind: 'peer', places: 1, count: 6, names: ['payments-api'], window: '2h', called: true } },
      ]);
      expect(saySignal(api)).toBe('gateway called payments-api by its peer.service, which no configured service is: 6 spans in 2h');
      expect(saySeen(api.places[0]!.seen!)).toBe('called payments-api, 6 spans in 2h (peer.service)');
    });

    it('groups with the spans of the service itself, one kind of evidence, both said in one sentence', () => {
      const groups = rankMissing(missingRepoSignals({ nodes: [], unresolved: [routes, fromGateway, fromOrders] }, REPORT), SERVICES);
      expect(groups.map((group) => [group.token, group.score, group.places, group.kinds])).toEqual([['payments', 1, 3, ['traffic']]]);
      const both = groups[0]!.signals.find((signal) => signal.name === 'payments')!;
      expect(saySignal(both)).toBe('traffic came from payments, which no configured service is: 2 routes, 4 spans in 2h; orders called it by its peer.service: 1 span in 2h');
      // Each caller's blind spots hand on to the group, so a check on them names the repository.
      expect(missingTokenOfGap(missingByGap(groups), 'gap:gateway||seen-not-in-code')).toBe('payments');
    });

    it('reads every peer a group holds, not only the five it lists, and never a configured service by alias', () => {
      const names: Array<[string, number]> = ['ledger', 'payments', 'refunds', 'risk', 'search', 'tax'].map((name, at) => [name, 10 - at]);
      const cut = blind('gateway', 'peer', names.slice(0, 5));
      const row = { ...cut, meta: { ...cut.meta, peers: names.map(([name, count]) => ({ name, count, lastSeen: null })) } };
      expect(missingRepoSignals({ nodes: [], unresolved: [row] }, REPORT).map((signal) => signal.name)).toContain('tax');
      const aliased = rankMissing(missingRepoSignals({ nodes: [], unresolved: [blind('orders', 'peer', [['billing', 2]])] }, REPORT), [
        ...SERVICES,
        { name: 'invoices', aliases: ['billing'] },
      ]);
      expect(aliased).toEqual([]);
    });
  });
});

describe('a subscription nothing here writes to (P204)', () => {
  /** A declared stream a function reads, as the linker leaves it: the consume edge, no write, its row. */
  const stream: GraphNode = {
    id: 'channel:kinesis/payments',
    type: 'channel',
    label: 'kinesis/payments',
    repo: 'jobs',
    file: 'infra/main.tf',
    line: 40,
    meta: { adapters: ['aws-kinesis'], declaredBy: ['jobs'] },
  };
  const ledger: GraphNode = { id: 'consumer:jobs#ledger', type: 'consumer', label: 'ledger', repo: 'jobs', file: 'infra/main.tf', line: 46 };
  const reads: GraphEdge = { from: stream.id, to: ledger.id, type: 'consumes', confidence: 'static' };
  const unwritten: MissingRow = {
    reason: 'stream-no-writer',
    service: 'jobs',
    file: 'infra/main.tf',
    line: 40,
    symbol: stream.id,
    message: 'kinesis/payments is read by a function and nothing in the configured services writes to it',
  };
  /** A rule taking events by a pattern, as the deployment reader writes its consumer. */
  const rule = (id: string, sources: unknown[], line = 60): GraphNode => ({
    id,
    type: 'consumer',
    label: `rule ${id}`,
    repo: 'jobs',
    file: 'infra/main.tf',
    line,
    meta: {
      channelPattern: {
        parts: [
          { name: 'service', filters: [{ equals: 'eventbridge' }] },
          { name: 'bus', filters: [{ equals: 'default' }] },
          { name: 'source', filters: sources },
          { name: 'detail-type', filters: [{ equals: 'PaymentCaptured' }] },
        ],
      },
    },
  });
  const matchesNothing = (node: GraphNode): MissingRow => ({
    reason: 'subscription-matches-nothing',
    service: 'jobs',
    file: 'infra/main.tf',
    line: node.line ?? 0,
    symbol: node.id,
    message: `${node.label} takes events by a pattern that no publisher in the configured services matches`,
  });
  const receipts = rule('receipts', [{ equals: 'acme.payments' }]);
  const report = { ...(REPORT as object), channels: { noConsumers: [], noProducers: [stream.id] } } as never;

  it('reads a stream nothing writes to by its name, as a subscription, and not again as a channel with one end', () => {
    const signals = missingRepoSignals({ nodes: [stream, ledger], edges: [reads], unresolved: [unwritten] }, report);
    expect(signals.map((signal) => [signal.kind, signal.name, signal.token, signal.reads])).toEqual([['subscription', 'kinesis/payments', 'payments', 'stream']]);
    expect(signals[0]?.places).toEqual([{ service: 'jobs', file: 'infra/main.tf', line: 40, gapId: 'gap:jobs|infra/main.tf|stream-no-writer' }]);
    expect(saySignal(signals[0]!)).toBe('stream kinesis/payments is read by jobs and nothing here writes to it');
    // Accepted (its row gone), the stream is no evidence at all: the row was the one reading of it.
    expect(missingRepoSignals({ nodes: [stream, ledger], edges: [reads], unresolved: [] }, report)).toEqual([]);
    // A channel nobody declared, read and never written, stays a channel with one end.
    const plain = { ...stream, meta: { adapters: ['aws-kinesis'] } };
    expect(missingRepoSignals({ nodes: [plain, ledger], edges: [reads], unresolved: [] }, report).map((signal) => signal.kind)).toEqual(['channel']);
  });

  it('reads a rule nothing published matches by the sources it names, the last dotted word the token', () => {
    const prefix = rule('partner-titles', [{ prefix: 'partner.' }], 70);
    const signals = missingRepoSignals({ nodes: [receipts, prefix], unresolved: [matchesNothing(receipts), matchesNothing(prefix)] }, REPORT);
    expect(signals.map((signal) => [signal.kind, signal.name, signal.token, signal.reads])).toEqual([
      ['subscription', 'acme.payments', 'payments', 'rule'],
      ['subscription', 'partner.*', 'partner', 'rule'],
    ]);
    expect(saySignal(signals[0]!)).toBe('events from acme.payments are taken by jobs (1 rule) and nothing here publishes one');
    expect(signals[0]?.places[0]?.gapId).toBe('gap:jobs|infra/main.tf|subscription-matches-nothing');
  });

  it("names no writer for the platform's own sources, nor for a pattern without a source", () => {
    const platform = rule('backups', [{ equals: 'aws.backup' }, { prefix: 'aws.partner/' }]);
    const sourceless: GraphNode = { ...receipts, id: 'any', meta: { channelPattern: { parts: [{ name: 'source', filters: [] }] } } };
    const negated = rule('not-mine', [{ anythingBut: [{ equals: 'acme.orders' }] }]);
    expect(missingRepoSignals({ nodes: [platform, sourceless, negated], unresolved: [platform, sourceless, negated].map(matchesNothing) }, REPORT)).toEqual([]);
  });

  it('is one kind for both, weak alone, after a channel, and agrees with the others on one name', () => {
    const both = rankMissing(missingRepoSignals({ nodes: [stream, ledger, receipts], edges: [reads], unresolved: [unwritten, matchesNothing(receipts)] }, report), SERVICES);
    expect(both.map((group) => [group.token, group.score, group.places, group.kinds])).toEqual([['payments', 1, 2, ['subscription']]]);
    expect(worthSaying(both[0]!)).toBe(false);
    const node = call('http_out:gateway#a', 'gateway', { baseUrlEnv: 'PAYMENTS_URL' });
    const channel: GraphNode = { id: 'channel:payment.requested', type: 'channel', label: 'payment.requested', repo: 'orders', file: 'src/o.ts', line: 7 };
    const agreed = rankMissing(
      missingRepoSignals(
        { nodes: [node, channel, stream, ledger, receipts], edges: [reads], unresolved: [unclaimed(node.id, 'PAYMENTS_URL'), unwritten, matchesNothing(receipts)] },
        { ...(REPORT as object), channels: { noConsumers: [channel.id], noProducers: [stream.id] } } as never,
      ),
      SERVICES,
    );
    expect(agreed.map((group) => [group.token, group.score, group.kinds])).toEqual([['payments', 3, ['setting', 'channel', 'subscription']]]);
    expect(worthSaying(agreed[0]!)).toBe(true);
    expect(missingTokenOfGap(missingByGap(agreed), 'gap:jobs|infra/main.tf|stream-no-writer')).toBe('payments');
  });

  it('is dropped when the name is a configured service', () => {
    const signals = missingRepoSignals({ nodes: [receipts], unresolved: [matchesNothing(receipts)] }, REPORT);
    expect(rankMissing(signals, [...SERVICES, { name: 'payments-api' }])).toEqual([]);
  });

  it('subscriptionSources reads equals, any case, prefix and wildcard values', () => {
    expect(subscriptionSources(rule('r', [{ equals: 'com.acme.payments' }, { equalsIgnoreCase: 'Acme.Shipping' }, { wildcard: 'acme.*.billing' }, { exists: true }]))).toEqual([
      { name: 'com.acme.payments', token: 'payments' },
      { name: 'Acme.Shipping', token: 'Shipping' },
      { name: 'acme.*.billing', token: 'billing' },
    ]);
  });
});
