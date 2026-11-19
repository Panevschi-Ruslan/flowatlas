import assert from 'node:assert/strict';
import { test } from 'node:test';
import { judgeLabels, parseWay, readLabels } from './labels.mjs';
import { clonePaths } from './read-gate.mjs';

/**
 * A shop of two services: a storefront at `web` that calls the back end at
 * `api`, which serves three routes, a GraphQL endpoint and a queue. Invented,
 * and small enough that every label's answer can be checked by eye.
 */
const services = [
  { name: 'web', repo: 'apps/web' },
  { name: 'api', repo: 'apps/api' },
];

const node = (type, repo, file, line, col, extra = {}) => ({
  id: `${type}:${repo}#${file}:${line}:${col}`,
  type,
  label: '',
  repo,
  file,
  line,
  ...extra,
});

const entry = (repo, kind, key, file = 'src/x.ts', line = 1) => ({
  id: `entry:${repo}:${kind}:${key}`,
  type: 'entry',
  kind,
  label: key,
  repo,
  file,
  line,
});

const graph = {
  nodes: [
    entry('api', 'http', 'GET:/api/cart'),
    entry('api', 'http', 'POST:/api/cart'),
    entry('api', 'http', 'GET:/api/orders/:param'),
    { ...entry('api', 'http', 'POST:/graphql'), meta: { graphql: { endpoint: true } } },
    entry('api', 'graphql', 'Mutation.placeOrder@/graphql'),
    entry('api', 'graphql', 'Order.total@/graphql'),
    entry('api', 'event', 'mail'),
    { id: 'channel:mail', type: 'channel', label: 'mail', repo: 'api', file: 'src/mail.ts', line: 3 },
    {
      id: 'consumer:api#src/mail.processor.ts:MailProcessor.process',
      type: 'consumer',
      repo: 'api',
      file: 'src/mail.processor.ts',
      line: 9,
      meta: { entryId: 'entry:api:event:mail' },
    },
    { id: 'external_api:payments.example.com', type: 'external_api', label: 'payments.example.com', repo: 'api' },
    // The calls.
    node('ui_api_call', 'web', 'src/cart.ts', 10, 5),
    node('ui_api_call', 'web', 'src/cart.ts', 20, 5),
    node('ui_api_call', 'web', 'src/orders.ts', 7, 3),
    node('ui_api_call', 'web', 'src/checkout.ts', 30, 9),
    node('ui_api_call', 'web', 'src/search.ts', 4, 1),
    node('ui_api_call', 'web', 'src/search.ts', 12, 1),
    node('http_out', 'api', 'src/pay.ts', 15, 7),
    node('http_out', 'api', 'src/legacy.ts', 22, 7),
    node('producer', 'api', 'src/mail.ts', 3, 5, { meta: { jobName: 'welcome' } }),
    node('ui_api_call', 'web', 'src/two.ts', 5, 1),
    node('ui_api_call', 'web', 'src/two.ts', 5, 40),
    node('ui_api_call', 'web', 'src/records.ts', 12, 3),
    node('ui_api_call', 'web', 'src/records.ts', 20, 3),
  ],
  edges: [
    // Right: the cart is read from GET /api/cart.
    { from: 'ui_api_call:web#src/cart.ts:10:5', to: 'entry:api:http:GET:/api/cart', type: 'hits' },
    // Wrong: a POST joined onto the GET.
    { from: 'ui_api_call:web#src/cart.ts:20:5', to: 'entry:api:http:GET:/api/cart', type: 'hits' },
    // Right, through a parameter spelled differently on each side.
    { from: 'ui_api_call:web#src/orders.ts:7:3', to: 'entry:api:http:GET:/api/orders/:param', type: 'hits' },
    // A GraphQL request: its endpoint, its root field and a nested field.
    { from: 'ui_api_call:web#src/checkout.ts:30:9', to: 'entry:api:http:POST:/graphql', type: 'hits' },
    { from: 'ui_api_call:web#src/checkout.ts:30:9', to: 'entry:api:graphql:Mutation.placeOrder@/graphql', type: 'hits' },
    { from: 'ui_api_call:web#src/checkout.ts:30:9', to: 'entry:api:graphql:Order.total@/graphql', type: 'hits' },
    // Ambiguous: one search joined onto two routes.
    { from: 'ui_api_call:web#src/search.ts:4:1', to: 'entry:api:http:GET:/api/cart', type: 'hits' },
    { from: 'ui_api_call:web#src/search.ts:4:1', to: 'entry:api:http:GET:/api/orders/:param', type: 'hits' },
    // An external call recorded as one.
    { from: 'http_out:api#src/pay.ts:15:7', to: 'external_api:payments.example.com', type: 'http_calls' },
    // An external call joined onto a route of the system.
    { from: 'http_out:api#src/legacy.ts:22:7', to: 'entry:api:http:POST:/api/cart', type: 'http_calls' },
    // A producer to a queue a processor consumes.
    { from: 'producer:api#src/mail.ts:3:5', to: 'channel:mail', type: 'emits' },
    { from: 'channel:mail', to: 'consumer:api#src/mail.processor.ts:MailProcessor.process', type: 'consumes' },
    // Two calls on one line, told apart by column.
    { from: 'ui_api_call:web#src/two.ts:5:1', to: 'entry:api:http:GET:/api/cart', type: 'hits' },
    { from: 'ui_api_call:web#src/two.ts:5:40', to: 'entry:api:http:POST:/api/cart', type: 'hits' },
    // Two GraphQL requests whose documents are built at run time: the endpoint alone.
    { from: 'ui_api_call:web#src/records.ts:12:3', to: 'entry:api:http:POST:/graphql', type: 'hits' },
    { from: 'ui_api_call:web#src/records.ts:20:3', to: 'entry:api:http:POST:/graphql', type: 'hits' },
  ],
  unresolved: [
    { file: 'src/records.ts', line: 12, reason: 'graphql-document-dynamic', service: 'web' },
    { file: 'src/dynamic.ts', line: 8, reason: 'url-dynamic', service: 'web' },
    {
      file: 'src/folded.ts',
      line: 2,
      reason: 'url-dynamic',
      service: 'web',
      meta: { causes: [{ samples: [{ file: 'src/folded.ts', line: 2 }, { file: 'src/other.ts', line: 6 }] }] },
    },
  ],
};

/** The source of every file a label names, as the clone would have it. */
const sources = {
  'apps/web/src/cart.ts': Array.from({ length: 25 }, (_, index) => `line ${index + 1}`).join('\n'),
  'apps/web/src/moved.ts': 'a\nb\nc\nd\nawait api.get(`/cart`)\n',
};
const readSource = (file) => sources[file] ?? (file.startsWith('apps/') ? '' : undefined);

const judge = (labels) =>
  judgeLabels({ labels, graph, toPath: clonePaths(services), readSource });

const one = (label) => judge([label]).rows[0];

test('a way in is spelled one way on both sides', () => {
  assert.deepEqual(parseWay('http post /api/orders/{id}/'), { kind: 'http', key: 'POST /api/orders/:param' });
  assert.deepEqual(parseWay('http GET /api/orders/[id]?page=2'), { kind: 'http', key: 'GET /api/orders/:param' });
  assert.deepEqual(parseWay('http GET /api/orders/${orderId}'), { kind: 'http', key: 'GET /api/orders/:param' });
  assert.deepEqual(parseWay('graphql Mutation.placeOrder'), { kind: 'graphql', key: 'Mutation.placeOrder' });
  assert.equal(parseWay('nonsense'), undefined);
});

test('the right way in, and nothing else, is right', () => {
  const row = one({ file: 'apps/web/src/cart.ts', line: 10, kind: 'browser', expect: 'http GET /api/cart' });
  assert.equal(row.outcome, 'right');
  assert.equal(row.got, 'http GET /api/cart');
});

test('a parameter spelled differently by the label still matches', () => {
  const row = one({ file: 'apps/web/src/orders.ts', line: 7, kind: 'browser', expect: 'http GET /api/orders/:orderId' });
  assert.equal(row.outcome, 'right');
});

test('a route that answers every verb answers the one a label names', () => {
  const allGraph = {
    nodes: [
      entry('api', 'http', 'ALL:/api/hooks/*'),
      node('ui_api_call', 'web', 'src/hooks.ts', 3, 1),
    ],
    edges: [{ from: 'ui_api_call:web#src/hooks.ts:3:1', to: 'entry:api:http:ALL:/api/hooks/*', type: 'hits' }],
  };
  const [row] = judgeLabels({
    labels: [{ file: 'apps/web/src/hooks.ts', line: 3, kind: 'browser', expect: 'http POST /api/hooks/[...rest]' }],
    graph: allGraph,
    toPath: clonePaths(services),
    readSource,
  }).rows;
  assert.equal(row.outcome, 'right');
});

test('a call read by both halves is right where either half joined the right way in (P292)', () => {
  const browser = node('ui_api_call', 'web', 'src/loader.ts', 4, 9, { meta: { sameCall: 'http_out:web#src/loader.ts:4:9' } });
  const server = node('http_out', 'web', 'src/loader.ts', 4, 9, { meta: { sameCall: browser.id } });
  const pairGraph = (to) => ({
    nodes: [entry('api', 'http', 'GET:/api/cart'), entry('web', 'http', 'GET:/cart'), browser, server],
    edges: to.map(([from, entryId]) => ({ from, to: entryId, type: from === browser.id ? 'hits' : 'http_calls' })),
  });
  const judgeOn = (pairs, label = { file: 'apps/web/src/loader.ts', line: 4, kind: 'browser', expect: 'http GET /api/cart' }) =>
    judgeLabels({ labels: [label], graph: pairGraph(pairs), toPath: clonePaths(services), readSource }).rows[0];
  // One half right, the other elsewhere: right, not right-and-also-elsewhere.
  assert.equal(judgeOn([[server.id, 'entry:api:http:GET:/api/cart'], [browser.id, 'entry:web:http:GET:/cart']]).outcome, 'right');
  // One half right, the other joined nothing: right.
  assert.equal(judgeOn([[browser.id, 'entry:api:http:GET:/api/cart']]).outcome, 'right');
  // Both halves elsewhere: wrong.
  assert.equal(judgeOn([[browser.id, 'entry:web:http:GET:/cart'], [server.id, 'entry:web:http:GET:/cart']]).outcome, 'wrong');
  // A label naming the server half's column alone still judges the pair.
  const columned = { file: 'apps/web/src/loader.ts', line: 4, column: 9, kind: 'browser', expect: 'http GET /api/cart' };
  assert.equal(judgeOn([[browser.id, 'entry:api:http:GET:/api/cart']], columned).outcome, 'right');
});

test('another way in is wrong, and says what it got', () => {
  const row = one({ file: 'apps/web/src/cart.ts', line: 20, kind: 'browser', expect: 'http POST /api/cart' });
  assert.equal(row.outcome, 'wrong');
  assert.equal(row.got, 'http GET /api/cart');
});

test('a site with no call recorded is missed, and names a call close by', () => {
  const row = one({ file: 'apps/web/src/cart.ts', line: 12, kind: 'browser', expect: 'http GET /api/cart' });
  assert.equal(row.outcome, 'missed');
  assert.equal(row.got, 'no call recorded at this line (one at line 10)');
});

test('the right way in and another one besides is right and also elsewhere', () => {
  const row = one({ file: 'apps/web/src/search.ts', line: 4, kind: 'browser', expect: 'http GET /api/cart' });
  assert.equal(row.outcome, 'ambiguous');
  assert.match(row.got, /GET \/api\/orders/);
});

test('a GraphQL request is a call of its root field, not of its endpoint or nested fields', () => {
  const row = one({ file: 'apps/web/src/checkout.ts', line: 30, kind: 'graphql', expect: 'graphql Mutation.placeOrder' });
  assert.equal(row.outcome, 'right');
  assert.equal(row.got, 'graphql Mutation.placeOrder@/graphql');
});

test('an external call recorded as external is right for `none`', () => {
  const row = one({ file: 'apps/api/src/pay.ts', line: 15, kind: 'service', expect: 'none' });
  assert.equal(row.outcome, 'right');
  assert.equal(row.got, 'outside the system: payments.example.com');
});

test('an external call joined to a way in is falsely joined', () => {
  const row = one({ file: 'apps/api/src/legacy.ts', line: 22, kind: 'service', expect: 'none' });
  assert.equal(row.outcome, 'falsely');
});

test('a producer matches its channel, a consumer\'s way in, and its job', () => {
  assert.equal(one({ file: 'apps/api/src/mail.ts', line: 3, kind: 'producer', expect: 'channel mail' }).outcome, 'right');
  assert.equal(one({ file: 'apps/api/src/mail.ts', line: 3, kind: 'producer', expect: 'event mail' }).outcome, 'right');
  assert.equal(
    one({ file: 'apps/api/src/mail.ts', line: 3, kind: 'producer', expect: 'channel mail', job: 'welcome' }).outcome,
    'right',
  );
  const wrongJob = one({ file: 'apps/api/src/mail.ts', line: 3, kind: 'producer', expect: 'channel mail', job: 'reset' });
  assert.equal(wrongJob.outcome, 'wrong');
  assert.match(wrongJob.got, /job welcome/);
});

test('`unread-ok` wants a row at the site, folded samples included', () => {
  assert.equal(one({ file: 'apps/web/src/dynamic.ts', line: 8, kind: 'browser', expect: 'unread-ok' }).outcome, 'right');
  assert.equal(one({ file: 'apps/web/src/other.ts', line: 6, kind: 'browser', expect: 'unread-ok' }).outcome, 'right');
  assert.equal(one({ file: 'apps/web/src/dynamic.ts', line: 9, kind: 'browser', expect: 'unread-ok' }).outcome, 'missed');
});

test('a GraphQL request with an unread document goes through its endpoint and calls nothing (P279)', () => {
  const read = one({ file: 'apps/web/src/records.ts', line: 12, kind: 'graphql', expect: 'unread-ok' });
  assert.equal(read.outcome, 'right');
  assert.equal(one({ file: 'apps/web/src/records.ts', line: 20, kind: 'graphql', expect: 'unread-ok' }).outcome, 'missed');
  // Joined to the endpoint and a route besides is a join of something.
  assert.equal(one({ file: 'apps/web/src/checkout.ts', line: 30, kind: 'graphql', expect: 'unread-ok' }).outcome, 'falsely');
});

test('a column picks one of two calls on a line', () => {
  assert.equal(
    one({ file: 'apps/web/src/two.ts', line: 5, column: 40, kind: 'browser', expect: 'http POST /api/cart' }).outcome,
    'right',
  );
  assert.equal(
    one({ file: 'apps/web/src/two.ts', line: 5, kind: 'browser', expect: 'http POST /api/cart' }).outcome,
    'ambiguous',
  );
});

test('a site whose file or text is gone is reported, never dropped', () => {
  const gone = one({ file: 'elsewhere/x.ts', line: 1, kind: 'browser', expect: 'http GET /api/cart' });
  assert.equal(gone.outcome, 'drifted');
  const textGone = one({ file: 'apps/web/src/cart.ts', line: 10, text: 'fetch(', kind: 'browser', expect: 'http GET /api/cart' });
  assert.equal(textGone.outcome, 'drifted');
  assert.match(textGone.got, /no longer in the file/);
});

test('text found on another line moves the label there and says so', () => {
  const row = one({ file: 'apps/web/src/moved.ts', line: 2, text: 'api.get(`/cart`)', kind: 'browser', expect: 'http GET /api/cart' });
  assert.equal(row.line, 5);
  assert.equal(row.movedFrom, 2);
  assert.equal(row.outcome, 'missed');
});

test('precision counts every join made, recall every label expecting one', () => {
  const { total, byKind } = judge([
    { file: 'apps/web/src/cart.ts', line: 10, kind: 'browser', expect: 'http GET /api/cart' },
    { file: 'apps/web/src/cart.ts', line: 20, kind: 'browser', expect: 'http POST /api/cart' },
    { file: 'apps/web/src/search.ts', line: 4, kind: 'browser', expect: 'http GET /api/cart' },
    { file: 'apps/web/src/cart.ts', line: 12, kind: 'browser', expect: 'http GET /api/cart' },
    { file: 'apps/api/src/pay.ts', line: 15, kind: 'service', expect: 'none' },
    { file: 'apps/api/src/legacy.ts', line: 22, kind: 'service', expect: 'none' },
    { file: 'gone.ts', line: 1, kind: 'service', expect: 'http GET /api/cart' },
  ]);
  assert.deepEqual(
    { ...total, precision: undefined, recall: undefined },
    { labels: 7, right: 2, ambiguous: 1, wrong: 1, missed: 1, falsely: 1, drifted: 1, precision: undefined, recall: undefined },
  );
  // Joins made: the right one, the ambiguous one, the wrong one, the false one.
  assert.equal(total.precision, 1 / 4);
  // Expecting a join and found: four, of which two reached the right way in.
  assert.equal(total.recall, 2 / 4);
  assert.deepEqual(byKind.map((row) => row.kind), ['browser', 'service']);
  assert.equal(byKind[1].precision, 0);
  assert.equal(byKind[1].recall, null);
});

test('a label file with a hole in it is refused whole', () => {
  assert.throws(() => readLabels('{"labels":[{"file":"a.ts","expect":"none"}]}', 'x.json'), /label 1 has no line/);
  assert.throws(() => readLabels('{}', 'x.json'), /no `labels` list/);
  assert.equal(readLabels('{"labels":[{"file":"a.ts","line":1,"expect":"none"}]}', 'x.json').length, 1);
});
