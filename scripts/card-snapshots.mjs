#!/usr/bin/env node
/**
 * Records the prompt card each prompt gets (P386).
 *
 *   node scripts/card-snapshots.mjs [--update]
 *
 * The prompt hook hands the model, before its first turn, the compact answer
 * the graph server's own tools give for what a prompt names. These hold the
 * exact text of the card each prompt below gets from the `prompt-cards`
 * fixture's graph, or `(no card)`, and the name index the hook reads
 * (`card-names.json`, its build time left out). The card's age line is read
 * at the build's own time, so it says "just now" on every run.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promptCard, readCardNamesAt } from '../packages/cli/dist/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = join(root, 'fixtures', 'prompt-cards');
const outDir = join(fixture, 'expected.cards');
const cardsPath = join(fixture, '.flowatlas', 'card-names.json');
const update = process.argv.includes('--update');

/** One prompt per file, named for what it shows. */
const CASES = [
  ['route-aloud', 'Who calls GET /api/orders/{orderId}, and what breaks if I change it?'],
  ['route-path', 'is /api/orders/:id/cancel still used by the web app?'],
  ['handler-in-service', 'what breaks if I change OrdersController.findOne in stock-api'],
  ['client-method', "where does OrdersApiService.cancelOrder's request land?"],
  ['message-type', 'which code handles ORDER_CANCELLED?'],
  ['plain-word-channel', 'who reads the audit channel?'],
  ['backticked-channel', 'who reads `audit`?'],
  ['service-unused', 'what in shop-api is unused?'],
  ['method-across-channel', 'what reaches Mails.cancelled?'],
  ['method-inside-repository', 'tidy up OrdersPageComponent.cancel'],
  ['names-nothing', 'write a haiku about orders'],
  ['past-three-names', 'compare GET /api/orders/:id, POST /api/orders/:id/cancel, OrdersApiService.getOrder and ORDER_CANCELLED'],
];

const index = readCardNamesAt(cardsPath);
if (index === undefined) {
  console.error(`    no card name index at ${cardsPath}: run node scripts/fixtures-run.mjs fixtures/prompt-cards first`);
  process.exit(1);
}
const now = Date.parse(index.builtAt);

const files = new Map();
const { builtAt: _built, ...stableIndex } = index;
files.set('card-names.json', `${JSON.stringify(stableIndex, null, 2)}\n`);
for (const [name, prompt] of CASES) {
  const card = await promptCard(prompt, cardsPath, { now, index });
  files.set(`${name}.txt`, `prompt: ${prompt}\n---\n${card.text ?? '(no card)'}\n`);
}

const problems = [];
if (update) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const [file, text] of files) writeFileSync(join(outDir, file), text);
} else {
  for (const [file, text] of files) {
    let recorded;
    try {
      recorded = readFileSync(join(outDir, file), 'utf8');
    } catch {
      problems.push(`${file}: no snapshot; run node scripts/card-snapshots.mjs --update`);
      continue;
    }
    if (recorded !== text) problems.push(`${file}: differs from the snapshot`);
  }
  let recorded = [];
  try {
    recorded = readdirSync(outDir);
  } catch {
    recorded = [];
  }
  for (const file of recorded) if (!files.has(file)) problems.push(`${file}: snapshot for a prompt nobody asks any more`);
}
if (problems.length > 0) {
  for (const problem of problems) console.error(`    ${problem}`);
  console.error('Re-run with --update once the difference has been reviewed.');
  process.exit(1);
}
console.log(update ? `wrote ${files.size} card snapshot(s)` : `card snapshots ok: ${files.size} compared`);
process.exit(0);
