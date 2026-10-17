#!/usr/bin/env node
/**
 * Records what the server answers for a fixed set of questions.
 *
 *   node scripts/mcp-snapshots.mjs [--update]
 *
 * The tool tests assert behaviour; these snapshots hold the exact wire shape,
 * which is what every later phase renders from. A change here is a change other
 * packages will see, so it should be read before it is accepted.
 *
 * Three `describe_for_prompt` answers are also written as Markdown under
 * `fixtures/multi-repo/expected.prompt/` (P97): the page's "Copy as prompt"
 * must write exactly those files too, and the CLI's parity test checks it.
 *
 * The questions about a branch (P96) are asked of `fixtures/multi-repo-diff`,
 * made into a project with history, built and diffed first
 * (`diff-fixture.mjs`); so are the prompts and resources the server lists. A
 * case whose tool starts with `#` asks the client that, not a tool.
 */
import { isDeepStrictEqual } from 'node:util';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createFlowatlasServer } from '@flowatlas/mcp';
import { loadConfig } from '@flowatlas/core';
import { reasonCatalog, testPatternText } from '../packages/cli/dist/index.js';
import { diffFixtureProject } from './diff-fixture.mjs';
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
  // The three subjects the page's "Copy as prompt" is checked against (P97).
  ['describe_for_prompt.invoice', 'describe_for_prompt', { id: 'entry:gateway:http:POST:/orders/:param/invoice' }],
  ['describe_for_prompt.gap', 'describe_for_prompt', { id: 'gap:web|src/app/orders-api.service.ts|api-path-dynamic' }],
  // Answers that say where they stopped (P94): a caller walk cut by depth, a
  // route said with a real value, a literal segment beside a hole, every
  // crossing between two services, and a channel that does not exist.
  ['who_calls.depth-cut', 'who_calls', { symbol: 'orders#src/orders/orders.service.ts:OrdersService.findOne', depth: 2 }],
  ['who_calls.concrete-path', 'who_calls', { symbol: 'GET /orders/123' }],
  ['get_flow.literal-route', 'get_flow', { entry: 'GET /orders/latest', maxNodes: 8 }],
  ['check_contract.between-services', 'check_contract', { from: 'gateway', to: 'billing' }],
  ['who_emits.unknown-channel', 'who_emits', { channel: 'order.create' }],
  // Is it dead, what to look at, who uses a type, and a whole class, file or
  // service as one text (P95): a route nothing calls, one a call read in part
  // could reach, one a call one segment off names, a service's rows; every
  // finding counted; a shared type, a name two types have, a type only other
  // types hold; and a class answered for by its methods.
  ['dead.route', 'dead', { id: 'entry:billing:http:GET:/invoices/:param' }],
  ['dead.likely', 'dead', { id: 'GET /orders/latest' }],
  ['dead.one-off', 'dead', { id: 'entry:orders:http:POST:/orders/:param/archive' }],
  ['dead.alive', 'dead', { id: 'orders#src/orders/orders.service.ts:OrdersService' }],
  ['dead.by-service', 'dead', { service: 'orders' }],
  ['findings.all', 'findings', {}],
  ['findings.unguarded', 'findings', { kind: 'unguarded', maxNodes: 2 }],
  ['type_usage.order-dto', 'type_usage', { type: 'type:@fx/contracts#OrderDto' }],
  ['type_usage.ambiguous', 'type_usage', { type: 'OrderDto' }],
  ['type_usage.nested', 'type_usage', { type: 'Money' }],
  ['describe_for_prompt.class', 'describe_for_prompt', { id: 'orders#src/orders/orders.service.ts:OrdersService', scope: 'class' }],
  ['describe_for_prompt.file', 'describe_for_prompt', { id: 'orders#src/orders/orders.service.ts', scope: 'file' }],
  ['describe_for_prompt.service', 'describe_for_prompt', { id: 'orders', scope: 'service' }],
  ['describe_for_prompt.wrong-scope', 'describe_for_prompt', { id: 'POST /orders', scope: 'class' }],
  ['who_calls.class', 'who_calls', { symbol: 'orders#src/orders/orders.service.ts:OrdersService', depth: 1 }],
  ['impact.class', 'impact', { symbol: 'OrdersService' }],
  // The pages that describe what was asked about (P120), from the docs.json `flowatlas docs` wrote.
  ['describe_for_prompt.documented', 'describe_for_prompt', { id: 'entry:gateway:http:GET:/orders/:param', maxSteps: 3 }],
  ['impact.documented', 'impact', { symbol: 'orders#src/orders/orders.service.ts:OrdersService.create' }],
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
  // A finding asked for as a cause (P94): empty, and saying why.
  ['cant_follow.finding', 'cant_follow', { cause: 'query-in-loop' }],
  // The likely loops ranked by the ways in that reach them, the per-item ones counted (P95).
  ['findings.n-plus-one', 'findings', { kind: 'n-plus-one' }],
];

/**
 * What the reader could not follow (P75), asked the ways that used to answer
 * nothing (P94): a method nothing calls, in a file with gaps that may hide its
 * caller, and a cause that does not exist.
 */
const CANT_FOLLOW_CASES = [
  ['who_calls.top-of-chain', 'who_calls', { symbol: 'storefront#src/jobs/reminder.job.ts:ReminderJob.start' }],
  ['impact.no-entries', 'impact', { symbol: 'storefront#src/jobs/reminder.job.ts:ReminderJob.start' }],
  ['cant_follow.unknown-cause', 'cant_follow', { cause: 'dynamic-membr' }],
  // The same method asked whether it is dead (P95): nothing calls it, and its class is not reached either.
  ['dead.top-of-chain', 'dead', { id: 'storefront#src/jobs/reminder.job.ts:ReminderJob.start' }],
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

/**
 * A branch (P96): five edits to a project of three services - a required
 * field the gateway does not send, an import split over lines, a method
 * removed, a drift annotated, and a route renamed that the gateway still asks
 * for beside a method that now picks its receiver at run time. Asked for the
 * verdict, for one service, without the verdict, and the prompts and
 * resources that start such a review.
 */
const DIFF_CASES = [
  ['what_changed.verdict', 'what_changed', { verdict: true }],
  ['what_changed.by-service', 'what_changed', { verdict: true, service: 'orders' }],
  ['what_changed.plain', 'what_changed', { service: 'billing' }],
  ['what_changed.no-such-service', 'what_changed', { verdict: true, service: 'shipping' }],
  ['prompts.list', '#listPrompts', {}],
  ['prompt.before-rename', '#getPrompt', { name: 'before-rename', arguments: { symbol: 'entry:orders:http:POST:/orders' } }],
  ['prompt.before-rename-ambiguous', '#getPrompt', { name: 'before-rename', arguments: { symbol: 'POST /orders' } }],
  ['prompt.pr-review', '#getPrompt', { name: 'pr-review', arguments: {} }],
  ['prompt.pr-review-other-base', '#getPrompt', { name: 'pr-review', arguments: { base: 'main' } }],
  ['prompt.trace-route', '#getPrompt', { name: 'trace-route', arguments: { route: 'entry:gateway:http:POST:/orders' } }],
  ['prompt.trace-route-stops', '#getPrompt', { name: 'trace-route', arguments: { route: 'GET /orders/:param/shipment' } }],
  ['resources.list', '#listResources', {}],
  ['resources.templates', '#listResourceTemplates', {}],
  ['resource.services', '#readResource', { uri: 'flowatlas://services' }],
  ['resource.service-orders', '#readResource', { uri: 'flowatlas://services/orders' }],
];

/**
 * What a client asks besides a tool, by the name a case gives it, and the
 * document recorded: the listing as it comes, a resource's JSON read back.
 */
const CLIENT_ASKS = {
  '#listPrompts': (client) => client.listPrompts(),
  '#getPrompt': (client, args) => client.getPrompt(args),
  '#listResources': (client) => client.listResources(),
  '#listResourceTemplates': (client) => client.listResourceTemplates(),
  '#readResource': async (client, args) => JSON.parse((await client.readResource(args)).contents[0].text),
};

/**
 * The Markdown of three answers above, written out as the prompt snapshots
 * (P97): the page's "Copy as prompt" test and the server's test both read
 * them, so one file is what both sides must write.
 */
const PROMPTS = {
  dir: join(fixture, 'expected.prompt'),
  files: { 'describe_for_prompt.invoice': 'entry.md', 'describe_for_prompt.channel': 'channel.md', 'describe_for_prompt.gap': 'row.md' },
};

/**
 * A draft rule checked before it is suggested (P121): what `test_pattern`
 * answers for a rule that reads the call, and for one that cannot be said.
 * The server is handed the command line's own tester, as `flowatlas mcp` is.
 */
const housePatterns = join(root, 'fixtures', 'house-patterns');
const PATTERN_CASES = [
  ['test_pattern.draft', 'test_pattern', {
    yaml: '- id: shop-bus-emit\n  kind: publish\n  on: { receiverType: ShopBus }\n  pattern: "$BUS.emit({ topic: $CHANNEL, data: $PAYLOAD })"\n  channel: $CHANNEL\n  payload: $PAYLOAD\n',
    code: "bus.emit({ topic: 'book.added', data: book })",
  }],
  ['test_pattern.refused', 'test_pattern', {
    yaml: '- id: shop-bus-later\n  kind: publish\n  on: { receiverType: ShopBus }\n  pattern: "$BUS.later(() => $TOPIC)"\n  channel: $TOPIC\n',
  }],
];
const patternTester = (input) =>
  testPatternText(input, { config: loadConfig(join(housePatterns, 'flowatlas.config.json'), { checkRepos: false }).config });

/**
 * What real traffic did (P105), asked of the multi-repo graph with the
 * observed file `flowatlas observe` wrote over the fixture's traces: the
 * CLI's `observe.json` snapshot, put beside a copy of the fixture's database
 * so no other suite sees it. The busiest ways in, the slowest steps, a slow
 * and a failing request step by step, an entry with no sample, and the rows
 * of get_flow, who_calls and list_entries with timings beside `observed`;
 * then the statuses ways in answered that their code does not declare, and
 * the declared ones nobody answered, on their own and on get_flow and
 * describe_for_prompt (P106).
 */
const OBSERVED_CASES = [
  ['hot_paths.all', 'hot_paths', {}],
  ['hot_paths.by-service', 'hot_paths', { service: 'billing', limit: 1, joins: 1 }],
  ['slow_steps.all', 'slow_steps', { minCount: 1 }],
  ['slow_steps.by-max', 'slow_steps', { by: 'max', minCount: 1, limit: 3 }],
  ['slow_steps.entry', 'slow_steps', { entry: 'entry:gateway:http:GET:/orders/:param', minCount: 1 }],
  ['slow_steps.too-few', 'slow_steps', { minCount: 50 }],
  ['trace_for.route', 'trace_for', { entry: 'POST /orders' }],
  ['trace_for.cross-service', 'trace_for', { entry: 'entry:gateway:http:GET:/orders/:param' }],
  ['trace_for.cut', 'trace_for', { entry: 'POST /invoices', maxNodes: 2 }],
  ['trace_for.no-sample', 'trace_for', { entry: 'entry:orders:http:POST:/orders/:param/archive' }],
  ['get_flow.observed', 'get_flow', { entry: 'entry:gateway:http:GET:/orders/:param' }],
  ['who_calls.observed', 'who_calls', { symbol: 'orders#src/orders/orders.service.ts:OrdersService.findOne', depth: 6 }],
  ['list_entries.observed', 'list_entries', { service: 'billing' }],
  ['undeclared_failures.all', 'undeclared_failures', {}],
  ['undeclared_failures.bounded', 'undeclared_failures', { service: 'billing', limit: 1, minHits: 2 }],
  ['get_flow.failures', 'get_flow', { entry: 'POST /invoices' }],
  ['describe_for_prompt.failures', 'describe_for_prompt', { id: 'entry:billing:http:POST:/invoices' }],
];

/** A copy of the fixture's output with the observed file beside it, removed when the run ends. */
const observedCopy = () => {
  const copy = mkdtempSync(join(tmpdir(), 'flowatlas-mcp-observed-'));
  cpSync(join(fixture, '.flowatlas'), copy, { recursive: true });
  copyFileSync(join(fixture, 'expected.cli', 'observe.json'), join(copy, 'observed.json'));
  return copy;
};

const SUITES = [
  { fixture, outDir, cases: CASES, prompts: PROMPTS },
  { fixture: housePatterns, outDir: join(housePatterns, 'expected.mcp'), cases: PATTERN_CASES, options: { patternTester } },
  {
    fixture,
    outDir: join(fixture, 'expected.mcp.observed'),
    cases: OBSERVED_CASES,
    copy: observedCopy,
  },
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
    fixture: join(root, 'fixtures', 'cant-follow'),
    outDir: join(root, 'fixtures', 'cant-follow', 'expected.mcp'),
    cases: CANT_FOLLOW_CASES,
  },
  {
    fixture: join(root, 'fixtures', 'multi-repo-plumbing'),
    outDir: join(root, 'fixtures', 'multi-repo-plumbing', 'expected.mcp'),
    cases: PLUMBING_CASES,
  },
  {
    outDir: join(root, 'fixtures', 'multi-repo-diff', 'expected.mcp'),
    cases: DIFF_CASES,
    // Made, built and diffed each run, and removed after: the fixture is two revisions as files.
    setup: () => diffFixtureProject(root),
    options: { reasonCatalog: reasonCatalog() },
  },
];

const problems = [];
let compared = 0;
let written = 0;

for (const suite of SUITES) {
  const made = suite.setup === undefined ? undefined : await suite.setup();
  const configPath = made?.config ?? join(suite.fixture, 'flowatlas.config.json');
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const copy = suite.copy?.();
  const server = createFlowatlasServer({
    configPath,
    ...(copy === undefined ? {} : { dbPath: join(copy, 'graph.db') }),
    ...(suite.options ?? {}),
  });
  await server.connect(serverSide);
  const client = new Client({ name: 'snapshots', version: '0' });
  await client.connect(clientSide);
  // Listing the tools first makes the client check every answer below against
  // its tool's outputSchema (P93), so a snapshot can only hold a declared shape.
  await client.listTools();

  if (update) {
    rmSync(suite.outDir, { recursive: true, force: true });
    mkdirSync(suite.outDir, { recursive: true });
    if (suite.prompts !== undefined) {
      rmSync(suite.prompts.dir, { recursive: true, force: true });
      mkdirSync(suite.prompts.dir, { recursive: true });
    }
  }

  for (const [name, tool, args] of suite.cases) {
    let parsed;
    if (tool.startsWith('#')) parsed = await CLIENT_ASKS[tool](client, args);
    else {
      const response = await client.callTool({ name: tool, arguments: args });
      parsed = JSON.parse(response.content[0].text);
      // The text and structuredContent are one document; an error carries isError instead.
      if (response.isError === true ? response.structuredContent !== undefined : !isDeepStrictEqual(response.structuredContent, parsed)) {
        problems.push(`${name}: structuredContent is not the document the text holds`);
      }
    }
    const actual = `${JSON.stringify(parsed, null, 2)}\n`;
    const path = join(suite.outDir, `${name}.json`);
    const promptFile = suite.prompts?.files[name];
    if (promptFile !== undefined) {
      const promptPath = join(suite.prompts.dir, promptFile);
      if (update) writeFileSync(promptPath, parsed.markdown);
      else {
        let recorded;
        try {
          recorded = readFileSync(promptPath, 'utf8');
        } catch {
          recorded = undefined;
        }
        if (recorded !== parsed.markdown) problems.push(`${promptFile}: the prompt snapshot differs from ${name}'s markdown`);
      }
    }

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
  if (made !== undefined) rmSync(made.scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  if (copy !== undefined) rmSync(copy, { recursive: true, force: true });
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`    ${problem}`);
  console.error('Re-run with --update once the difference has been reviewed.');
  process.exit(1);
}
console.log(update ? `wrote ${written} mcp snapshot(s)` : `mcp snapshots ok: ${compared} compared`);
