#!/usr/bin/env node
/**
 * Records what the server answers for a fixed set of questions.
 *
 *   node scripts/mcp-snapshots.mjs [--update]
 *
 * The tool tests assert behaviour; these snapshots hold the exact wire shape,
 * which is what every later phase renders from. A change here is a change other
 * packages will see, so it should be read before it is accepted.
 */
import { isDeepStrictEqual } from 'node:util';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createFlowatlasServer } from '@flowatlas/mcp';
import { readGraphFile, resolveNodeId } from './fixture-nodes.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = join(root, 'fixtures', 'multi-repo');
const outDir = join(fixture, 'expected.mcp');
const update = process.argv.includes('--update');

// The two questions below are about a particular request, and a request's id
// carries the line it was written at. Asked for by the client method that makes
// it, so that a fixture can gain a line without this script needing an edit.
const graph = readGraphFile(join(fixture, '.flowatlas', 'project-graph.json'));
const requestIn = (method) => resolveNodeId(graph, { type: 'http_out', calledBy: method });

/** One question per file, named for what it asks. */
const CASES = [
  ['list_entries.all', 'list_entries', {}],
  ['list_entries.by-service', 'list_entries', { service: 'orders' }],
  ['list_entries.truncated', 'list_entries', { maxNodes: 3 }],
  ['get_flow.cross-service', 'get_flow', { entry: 'entry:gateway:http:GET:/orders/:param', depth: 8 }],
  ['get_flow.truncated', 'get_flow', { entry: 'entry:gateway:http:GET:/orders/:param', maxNodes: 5 }],
  ['get_flow.ambiguous', 'get_flow', { entry: 'GET /orders/1' }],
  ['get_flow.dead-end', 'get_flow', { entry: 'entry:gateway:http:POST:/orders/:param/cancel', detail: 2 }],
  // The two flows P92 measures by, asked with the defaults: each reaches billing.
  ['get_flow.post-orders', 'get_flow', { entry: 'POST /orders' }],
  ['get_flow.invoice', 'get_flow', { entry: 'POST /orders/:param/invoice' }],
  ['who_calls.cross-service', 'who_calls', { symbol: 'orders#src/orders/orders.service.ts:OrdersService.findOne', depth: 6 }],
  ['impact.service-method', 'impact', { symbol: 'orders#src/orders/orders.service.ts:OrdersService.findOne' }],
  ['who_emits.order-created', 'who_emits', { channel: 'order.created' }],
  ['who_consumes.order-created', 'who_consumes', { channel: 'order.created' }],
  ['who_consumes.no-handler', 'who_consumes', { channel: 'order.archived' }],
  ['get_type.shared', 'get_type', { type: 'type:@fx/contracts#OrderDto' }],
  ['get_type.ambiguous', 'get_type', { type: 'InvoiceDto' }],
  ['check_contract.shared', 'check_contract', {
    from: requestIn('gateway#src/clients/orders.client.ts:OrdersClient.fetchOne'),
    to: 'entry:orders:http:GET:/orders/:param',
  }],
  ['check_contract.hash-differs', 'check_contract', {
    from: requestIn('gateway#src/clients/billing.client.ts:BillingClient.requestInvoice'),
    to: 'entry:billing:http:POST:/invoices',
  }],
  ['find_symbol.partial', 'find_symbol', { query: 'fetchOne' }],
  ['start_here.all', 'start_here', {}],
  ['start_here.by-service', 'start_here', { service: 'gateway' }],
  ['who_calls.by-service', 'who_calls', { symbol: 'orders#src/orders/orders.service.ts:OrdersService.findOne', depth: 6, service: 'gateway' }],
  ['describe_for_prompt.entry', 'describe_for_prompt', { id: 'entry:gateway:http:POST:/orders/:param/cancel' }],
  ['describe_for_prompt.channel', 'describe_for_prompt', { id: 'order.created' }],
  ['cant_follow.all', 'cant_follow', {}],
  ['cant_follow.by-service', 'cant_follow', { service: 'gateway' }],
  ['describe_for_prompt.symbol', 'describe_for_prompt', { id: 'orders#src/orders/orders.service.ts:OrdersService.findOne' }],
];

/**
 * A throw through a helper (P90): the lending desk of
 * `fixtures/nest-check-through-helper`, whose failures name the helper with
 * what it can choose, and whose prompt says it in one line.
 */
const HELPER_CASES = [
  ['get_flow.renewals', 'get_flow', { entry: 'POST /desk/renewals' }],
  ['get_flow.overdue', 'get_flow', { entry: 'GET /desk/overdue' }],
  ['describe_for_prompt.renewals', 'describe_for_prompt', { id: 'POST /desk/renewals' }],
  ['search.fails-423', 'search', { query: '423', kinds: ['fails'] }],
];

/**
 * Loops that run a query per item (P89): searched busiest first, each saying
 * how sure it is, and written into the prompt with the ways in that reach it.
 */
const LOOPS_CASES = [
  ['search.query-in-loop', 'search', { query: 'query-in-loop', kinds: ['gaps'] }],
  ['describe_for_prompt.labels', 'describe_for_prompt', { id: 'GET /parcels/labels' }],
];

/**
 * Plumbing every method shares (P92): a logger, a counter and a repository
 * helper under every caller. Each node is written once, the budget goes to the
 * crossings first, and both flows reach billing with the defaults; cut tight,
 * the answer says which limit stopped it and which crossings it left.
 */
const PLUMBING_CASES = [
  ['get_flow.post-orders', 'get_flow', { entry: 'POST /orders' }],
  ['get_flow.invoice', 'get_flow', { entry: 'POST /orders/:param/invoice' }],
  ['get_flow.node-cap', 'get_flow', { entry: 'POST /orders', maxNodes: 12 }],
  ['get_flow.char-cap', 'get_flow', { entry: 'POST /orders/:param/invoice', maxChars: 3000 }],
  ['describe_for_prompt.post-orders', 'describe_for_prompt', { id: 'POST /orders' }],
];

const SUITES = [
  { fixture, outDir, cases: CASES },
  {
    fixture: join(root, 'fixtures', 'nest-check-through-helper'),
    outDir: join(root, 'fixtures', 'nest-check-through-helper', 'expected.mcp'),
    cases: HELPER_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'loops-worth-fixing'),
    outDir: join(root, 'fixtures', 'loops-worth-fixing', 'expected.mcp'),
    cases: LOOPS_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'multi-repo-plumbing'),
    outDir: join(root, 'fixtures', 'multi-repo-plumbing', 'expected.mcp'),
    cases: PLUMBING_CASES,
  },
];

const problems = [];
let compared = 0;
let written = 0;

for (const suite of SUITES) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createFlowatlasServer({ configPath: join(suite.fixture, 'flowatlas.config.json') });
  await server.connect(serverSide);
  const client = new Client({ name: 'snapshots', version: '0' });
  await client.connect(clientSide);
  // Listing the tools first makes the client check every answer below against
  // its tool's outputSchema (P93), so a snapshot can only hold a declared shape.
  await client.listTools();

  if (update) {
    rmSync(suite.outDir, { recursive: true, force: true });
    mkdirSync(suite.outDir, { recursive: true });
  }

  for (const [name, tool, args] of suite.cases) {
    const response = await client.callTool({ name: tool, arguments: args });
    const parsed = JSON.parse(response.content[0].text);
    // The text and structuredContent are one document; an error carries isError instead.
    if (response.isError === true ? response.structuredContent !== undefined : !isDeepStrictEqual(response.structuredContent, parsed)) {
      problems.push(`${name}: structuredContent is not the document the text holds`);
    }
    const actual = `${JSON.stringify(parsed, null, 2)}\n`;
    const path = join(suite.outDir, `${name}.json`);

    if (update) {
      writeFileSync(path, actual);
      written += 1;
      continue;
    }
    let expected;
    try {
      expected = readFileSync(path, 'utf8');
    } catch {
      problems.push(`${name}: no snapshot; run pnpm mcp:snapshots -- --update`);
      continue;
    }
    compared += 1;
    if (expected !== actual) problems.push(`${name}: answer differs from the snapshot`);
  }

  if (!update) {
    let recorded = [];
    try {
      recorded = readdirSync(suite.outDir).filter((file) => file.endsWith('.json'));
    } catch {
      recorded = [];
    }
    const extra = recorded.filter((file) => !suite.cases.some(([name]) => `${name}.json` === file));
    for (const file of extra) problems.push(`${file}: snapshot for a question nobody asks any more`);
  }

  await client.close();
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`    ${problem}`);
  console.error('Re-run with --update once the difference has been reviewed.');
  process.exit(1);
}
console.log(update ? `wrote ${written} mcp snapshot(s)` : `mcp snapshots ok: ${compared} compared`);
