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
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createFlowatlasServer } from '@flowatlas/mcp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = join(root, 'fixtures', 'multi-repo');
const outDir = join(fixture, 'expected.mcp');
const update = process.argv.includes('--update');

/** One question per file, named for what it asks. */
const CASES = [
  ['list_entries.all', 'list_entries', {}],
  ['list_entries.by-service', 'list_entries', { service: 'orders' }],
  ['list_entries.truncated', 'list_entries', { maxNodes: 3 }],
  ['get_flow.cross-service', 'get_flow', { entry: 'entry:gateway:http:GET:/orders/:param', depth: 8 }],
  ['get_flow.truncated', 'get_flow', { entry: 'entry:gateway:http:GET:/orders/:param', maxNodes: 5 }],
  ['get_flow.ambiguous', 'get_flow', { entry: 'GET /orders/1' }],
  ['get_flow.dead-end', 'get_flow', { entry: 'entry:gateway:http:POST:/orders/:param/cancel', detail: 2 }],
  ['who_calls.cross-service', 'who_calls', { symbol: 'orders#src/orders/orders.service.ts:OrdersService.findOne', depth: 6 }],
  ['impact.service-method', 'impact', { symbol: 'orders#src/orders/orders.service.ts:OrdersService.findOne' }],
  ['who_emits.order-created', 'who_emits', { channel: 'order.created' }],
  ['who_consumes.order-created', 'who_consumes', { channel: 'order.created' }],
  ['who_consumes.no-handler', 'who_consumes', { channel: 'order.archived' }],
  ['get_type.shared', 'get_type', { type: 'type:@fx/contracts#OrderDto' }],
  ['get_type.ambiguous', 'get_type', { type: 'InvoiceDto' }],
  ['check_contract.shared', 'check_contract', {
    from: 'http_out:gateway#src/clients/orders.client.ts:33:12',
    to: 'entry:orders:http:GET:/orders/:param',
  }],
  ['check_contract.hash-differs', 'check_contract', {
    from: 'http_out:gateway#src/clients/billing.client.ts:33:12',
    to: 'entry:billing:http:POST:/invoices',
  }],
  ['find_symbol.partial', 'find_symbol', { query: 'fetchOne' }],
];

const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
const server = createFlowatlasServer({ configPath: join(fixture, 'flowatlas.config.json') });
await server.connect(serverSide);
const client = new Client({ name: 'snapshots', version: '0' });
await client.connect(clientSide);

if (update) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
}

const problems = [];
let compared = 0;

for (const [name, tool, args] of CASES) {
  const response = await client.callTool({ name: tool, arguments: args });
  const actual = `${JSON.stringify(JSON.parse(response.content[0].text), null, 2)}\n`;
  const path = join(outDir, `${name}.json`);

  if (update) {
    writeFileSync(path, actual);
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
    recorded = readdirSync(outDir).filter((file) => file.endsWith('.json'));
  } catch {
    recorded = [];
  }
  const extra = recorded.filter((file) => !CASES.some(([name]) => `${name}.json` === file));
  for (const file of extra) problems.push(`${file}: snapshot for a question nobody asks any more`);
}

await client.close();

if (problems.length > 0) {
  for (const problem of problems) console.error(`    ${problem}`);
  console.error('Re-run with --update once the difference has been reviewed.');
  process.exit(1);
}
console.log(update ? `wrote ${CASES.length} mcp snapshot(s)` : `mcp snapshots ok: ${compared} compared`);
