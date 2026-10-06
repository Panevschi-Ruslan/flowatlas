import { describe, expect, it } from 'vitest';
import { checkContracts } from './check.js';
import { edge, field, graphOf, node, object } from './test-graph.js';

/** The two shapes every case here compares: what was published, and what a handler reads. */
const LOAN = object('Loan', [field('loanId', 'string'), field('borrowerId', 'string')]);
const NOTICE = object('Notice', [field('borrowerId', 'string'), field('subject', 'string')]);
const TYPES = { 'type:loans#Loan': LOAN, 'type:notices#Notice': NOTICE };

const QUEUE = { at: ['Records', '[]', 'body'], text: true };
const BUS_ONWARD = { at: ['detail'], text: false, beside: ['source', 'detail-type'] };

/** A publisher in code, a channel, and a consumer a deployment declares in front of a function. */
const published = (reads: Record<string, string> | undefined, envelope: unknown = QUEUE) => ({
  nodes: [
    node('method:loans#create', 'method', 'loans'),
    node('producer:loans#a.ts:1:1', 'producer', 'loans'),
    node('channel:sqs/loans', 'channel', 'loans'),
    node('consumer:notices#infra/main.tf:mapping', 'consumer', 'notices', {
      meta: { deployedBy: 'terraform', envelope },
    }),
    node('entry:notices:invoke:notify', 'entry', 'notices', {
      kind: 'invoke',
      ...(reads === undefined ? {} : { meta: { reads } }),
    }),
    node('notices#src/notify.ts:handler', 'function', 'notices'),
  ],
  edges: [
    edge('method:loans#create', 'calls', 'producer:loans#a.ts:1:1'),
    edge('producer:loans#a.ts:1:1', 'emits', 'channel:sqs/loans', { params: ['type:loans#Loan'] }),
    edge('channel:sqs/loans', 'consumes', 'consumer:notices#infra/main.tf:mapping'),
    edge('consumer:notices#infra/main.tf:mapping', 'calls', 'entry:notices:invoke:notify'),
    edge('entry:notices:invoke:notify', 'handles', 'notices#src/notify.ts:handler'),
  ],
});

const check = (parts: ReturnType<typeof published>) =>
  checkContracts(graphOf({ ...parts, types: TYPES }), { generatedAt: 'fixed' });

describe('a message compared through the wrapping it is delivered in', () => {
  it('compares what was published with what the handler parses out of the wrapping', () => {
    const report = check(published({ '': 'type:x#SQSEvent', 'Records[].body': 'type:notices#Notice' }));
    expect(report.edges.map((each) => each.receiver)).toEqual([
      { service: 'notices', typeId: 'type:notices#Notice', symbol: 'notices#src/notify.ts:handler' },
    ]);
    const missing = report.findings.find((finding) => finding.kind === 'missing_required');
    expect(missing?.field).toBe('subject');
    expect(missing?.message).toContain('notices reads the message at Records[].body of what it is handed, as text it parses');
  });

  it('says which of the three things stopped it when it cannot compare', () => {
    expect(check(published({ '': 'type:x#SQSEvent' })).unchecked.map((row) => row.reason)).toEqual(['message-unparsed']);
    expect(check(published(undefined)).unchecked.map((row) => row.reason)).toEqual(['handler-unread']);
    expect(check(published({}, null)).unchecked.map((row) => row.reason)).toEqual(['envelope-unread']);
  });

  it('compares a forwarded message from its publisher, wrapped, and keeps the wrapping keys quiet', () => {
    const parts = published({ 'Records[].body': 'type:notices#Notice' });
    const rule = 'consumer:routing#rules.tf:target';
    const forwarder = 'producer:routing#rules.tf:target';
    const report = check({
      nodes: [
        ...parts.nodes.map((each) => (each.id === 'channel:sqs/loans' ? node('channel:eventbridge/library/loans/LoanCreated', 'channel', 'loans') : each)),
        node('channel:sqs/digest', 'channel', 'routing'),
        node(rule, 'consumer', 'routing', { meta: { deployedBy: 'terraform', envelope: BUS_ONWARD } }),
        node(forwarder, 'producer', 'routing', { meta: { deployedBy: 'terraform' } }),
      ],
      edges: [
        edge('method:loans#create', 'calls', 'producer:loans#a.ts:1:1'),
        edge('producer:loans#a.ts:1:1', 'emits', 'channel:eventbridge/library/loans/LoanCreated', { params: ['type:loans#Loan'] }),
        edge('channel:eventbridge/library/loans/LoanCreated', 'consumes', rule),
        edge(rule, 'calls', forwarder),
        edge(forwarder, 'emits', 'channel:sqs/digest'),
        edge('channel:sqs/digest', 'consumes', 'consumer:notices#infra/main.tf:mapping'),
        edge('consumer:notices#infra/main.tf:mapping', 'calls', 'entry:notices:invoke:notify'),
        edge('entry:notices:invoke:notify', 'handles', 'notices#src/notify.ts:handler'),
      ],
    });
    expect(report.unchecked.map((row) => row.reason)).toEqual(['delivered-onward']);
    expect(report.edges.map((each) => [each.edgeKey, each.sender.typeId])).toEqual([
      [
        'producer:loans#a.ts:1:1|emits|consumer:notices#infra/main.tf:mapping',
        '{detail:type:loans#Loan;detail-type:unknown;source:unknown}',
      ],
    ]);
    // `source` and `detail-type` are on the wire and nobody at the sending end wrote them.
    expect(report.findings.map((finding) => [finding.kind, finding.field])).toEqual([
      ['missing_required', 'borrowerId'],
      ['extra_field', 'detail'],
      ['missing_required', 'subject'],
    ]);
  });

  it('compares a message a rule puts on another bus as it was sent, read at detail there', () => {
    const parts = published({ detail: 'type:notices#Notice' }, { at: ['detail'], text: false });
    const rule = 'consumer:routing#rules.tf:to-audit';
    const forwarder = 'producer:routing#rules.tf:to-audit';
    const report = check({
      nodes: [
        ...parts.nodes.map((each) => (each.id === 'channel:sqs/loans' ? node('channel:eventbridge/audit/loans/LoanCreated', 'channel', 'routing') : each)),
        node('channel:eventbridge/library/loans/LoanCreated', 'channel', 'loans'),
        node(rule, 'consumer', 'routing', { meta: { deployedBy: 'terraform', envelope: { at: [], text: false } } }),
        node(forwarder, 'producer', 'routing', { meta: { deployedBy: 'terraform' } }),
      ],
      edges: [
        edge('method:loans#create', 'calls', 'producer:loans#a.ts:1:1'),
        edge('producer:loans#a.ts:1:1', 'emits', 'channel:eventbridge/library/loans/LoanCreated', { params: ['type:loans#Loan'] }),
        edge('channel:eventbridge/library/loans/LoanCreated', 'consumes', rule),
        edge(rule, 'calls', forwarder),
        edge(forwarder, 'emits', 'channel:eventbridge/audit/loans/LoanCreated'),
        edge('channel:eventbridge/audit/loans/LoanCreated', 'consumes', 'consumer:notices#infra/main.tf:mapping'),
        edge('consumer:notices#infra/main.tf:mapping', 'calls', 'entry:notices:invoke:notify'),
        edge('entry:notices:invoke:notify', 'handles', 'notices#src/notify.ts:handler'),
      ],
    });
    expect(report.edges.map((each) => each.sender.typeId)).toEqual(['type:loans#Loan']);
    const missing = report.findings.filter((finding) => finding.kind === 'missing_required');
    expect(missing.map((finding) => finding.field)).toEqual(['subject']);
    expect(missing[0]?.message).toContain('routing hands it on as it was sent; notices reads the message at detail of what it is handed');
  });

  it('says a delivery hands on what it was given when there is no publisher to compare from', () => {
    const parts = published({ 'Records[].body': 'type:notices#Notice' });
    const report = check({
      nodes: [...parts.nodes, node('producer:notices#api.tf:route', 'producer', 'notices', { meta: { deployedBy: 'terraform' } })],
      edges: [...parts.edges, edge('producer:notices#api.tf:route', 'emits', 'channel:sqs/loans')],
    });
    expect(report.unchecked.map((row) => [row.reason, row.edge.from])).toEqual([['sender-forwards', 'producer:notices#api.tf:route']]);
  });
});

describe('a start compared with what it starts', () => {
  const started = (meta: Record<string, unknown>) => ({
    nodes: [
      node('method:loans#renew', 'method', 'loans'),
      node('producer:loans#renew.ts:3:3', 'producer', 'loans', {
        meta: { starts: 'workflow', envelope: { at: [], text: false }, ...meta },
      }),
      node('entry:loans:workflow:approval', 'entry', 'loans', {
        kind: 'workflow',
        label: 'workflow approval',
        meta: { reads: { '': '{borrowerId:unknown}' }, carriesOn: true },
      }),
    ],
    edges: [
      edge('method:loans#renew', 'calls', 'producer:loans#renew.ts:3:3'),
      edge('producer:loans#renew.ts:3:3', 'calls', 'entry:loans:workflow:approval'),
    ],
  });

  it('requires what the workflow reads and says nothing of what it carries on', () => {
    const report = check(started({ payload: '{loanId:string;renewal:boolean}' }));
    expect(report.findings.map((finding) => [finding.direction, finding.kind, finding.field])).toEqual([
      ['request', 'missing_required', 'borrowerId'],
    ]);
    expect(check(started({ payload: 'type:loans#Loan' })).findings).toEqual([]);
  });

  it('is unchecked when the call hands over nothing it declares', () => {
    expect(check(started({})).unchecked.map((row) => row.reason)).toEqual(['no-type-on-sender']);
  });
});
