#!/usr/bin/env node
/**
 * What an agent pays per question, held to a budget (P373).
 *
 *   node scripts/answer-budget.mjs            # check every answer against its budget
 *   node scripts/answer-budget.mjs --table    # the same, and print the table
 *   node scripts/answer-budget.mjs --update   # re-record the sizes, print before and after
 *
 * An agent pays, per question, the fixed overhead of every turn (the server's
 * instructions, the guide block, the tools it loaded) times its turns, plus
 * the answers it was handed, each re-sent on every later turn. The
 * instructions and the listing have ceilings in the tool tests; this holds the
 * answers. Each question in `answer-budget.json` is asked of a fixture's graph
 * as an agent asks it, compact (no `verbose`), and its answer is measured: the
 * characters of the text an agent is handed (and tokens, estimated as
 * characters / 4), the rows of its main lists, whether it says `complete`, and
 * how many calls the question takes when the agent follows the paging the
 * answer names (`nextOffset`, every page's characters counted).
 *
 * The right answer is written by hand beside each question, never recorded:
 * the ids a list must hold (`lists`), the ids it must not (`notListed`), a list
 * that must hold exactly the ids given (`exact`), what a row must say
 * (`rowsSay`: a verdict, a `reach`), and `complete`. A row is matched by its
 * `id` or, on a field's row, its `field`. `--update` rewrites only `fixed` and
 * `recorded`, the sizes. The rules are `answer-budget-rules.mjs`.
 *
 * It fails when an answer, or a part of the fixed overhead, grows past its
 * recorded size by more than 10% or 300 characters, whichever is larger; when
 * a list misses an id it must hold or holds one it must not; when an answer
 * says `complete: false` where the right answer is complete; and when a
 * question answered complete takes more than one call. A change that grows
 * an answer re-records with `--update` and says why in its commit.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createFlowatlasServer } from '@flowatlas/mcp';
import { loadConfig } from '@flowatlas/core';
import { CORE_TOOLS, guideDescription, missingCandidatesFor, reasonCatalog, sharedBlock } from '../packages/cli/dist/index.js';
import { ceilingOf, followOn, overBudget, rowsByList, tokensOf, wrongIn } from './answer-budget-rules.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const budgetPath = join(root, 'scripts', 'answer-budget.json');
const update = process.argv.includes('--update');
const table = update || process.argv.includes('--table');

const budget = JSON.parse(readFileSync(budgetPath, 'utf8'));
const { tolerance } = budget;

/** A server over a fixture's built graph, as `flowatlas mcp` serves it (with a pattern tester), and its client. */
const connect = async (fixtureDir, extra = {}) => {
  const configPath = join(fixtureDir, 'flowatlas.config.json');
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createFlowatlasServer({
    configPath,
    toolsPollMs: 0,
    reasonCatalog: reasonCatalog(),
    patternTester: async () => ({ rules: [] }),
    ...missingCandidatesFor(configPath),
    ...extra,
  });
  await server.connect(serverSide);
  const client = new Client({ name: 'answer-budget', version: '0' });
  await client.connect(clientSide);
  return client;
};

/** What a model reads of a listing: each tool's name, description and input schema. */
const modelVisible = (tools) => JSON.stringify(tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })));

/**
 * The overhead every turn carries, measured on one fixture: the instructions;
 * the guide block `flowatlas agents install --instructions` writes into a
 * team's AGENTS.md or CLAUDE.md and the skill's description, both read every
 * turn; and the listing a model reads, for the core tools the guide has an
 * agent load in one ToolSearch call, the tools the project is offered, and
 * all of them.
 */
const measureFixed = async () => {
  const fixture = join(root, 'fixtures', budget.fixedOn);
  const plain = await connect(fixture);
  const all = await connect(fixture, { allTools: true });
  try {
    const listed = (await plain.listTools()).tools;
    const every = (await all.listTools()).tools;
    const { config } = loadConfig(join(fixture, 'flowatlas.config.json'), { checkRepos: false });
    const services = config.services.map((service) => ({ name: service.name, type: service.type }));
    const guide = { services, here: [services[0].name] };
    return {
      instructions: plain.getInstructions()?.length ?? 0,
      guideBlock: sharedBlock(guide).length,
      skillDescription: guideDescription(guide).length,
      listingCore: modelVisible(every.filter((tool) => CORE_TOOLS.includes(tool.name))).length,
      listingDefault: modelVisible(listed).length,
      listingAll: modelVisible(every).length,
    };
  } finally {
    await plain.close();
    await all.close();
  }
};

/** Asks one question, following the paging its answer names, and measures what came back. */
const ask = async (client, question) => {
  const answers = [];
  // The answers whose rows make the whole answer: every page, or the last of a walk asked further.
  let counted = [];
  let chars = 0;
  let args = { ...question.args };
  for (let call = 0; call < 20; call += 1) {
    const response = await client.callTool({ name: question.tool, arguments: args });
    const text = response.content[0].text;
    chars += text.length;
    const parsed = JSON.parse(text);
    answers.push(parsed);
    counted.push(parsed);
    const on = response.isError === true ? undefined : followOn(question.tool, args, parsed);
    if (on === undefined) break;
    if (!on.paged) counted = [];
    args = on.args;
  }
  const lists = rowsByList(counted, question.lists);
  const rows = [...lists.values()].reduce((sum, list) => sum + list.length, 0);
  const last = answers.at(-1);
  // `complete` as the last answer says it; null where the tool says nothing of it (`dead` asked by ids).
  const complete = typeof last.complete === 'boolean' ? last.complete : null;
  return { first: answers[0], lists, measured: { chars, tokens: tokensOf(chars), rows, complete, calls: answers.length } };
};

const problems = [];
const notes = [];
const before = budget.recorded ?? {};
const after = {};
const fixedBefore = budget.fixed ?? {};
const fixed = await measureFixed();
for (const [part, chars] of Object.entries(fixed)) {
  const was = fixedBefore[part];
  if (update) continue;
  if (was === undefined) problems.push(`fixed ${part}: no budget; run node scripts/answer-budget.mjs --update`);
  else if (chars > ceilingOf(was, tolerance)) problems.push(`fixed ${part}: ${chars} characters, past its budget of ${was} (at most ${ceilingOf(was, tolerance)})`);
}

const byFixture = new Map();
for (const question of budget.questions) byFixture.set(question.fixture, [...(byFixture.get(question.fixture) ?? []), question]);
for (const [fixtureName, questions] of byFixture) {
  const client = await connect(join(root, 'fixtures', fixtureName));
  try {
    for (const question of questions) {
      const result = await ask(client, question);
      after[question.id] = result.measured;
      for (const wrong of wrongIn(question.expect ?? {}, result)) problems.push(`${question.id}: ${wrong}`);
      if (update) continue;
      const was = before[question.id];
      if (was === undefined) {
        problems.push(`${question.id}: no budget; run node scripts/answer-budget.mjs --update`);
        continue;
      }
      const said = overBudget(question.id, result.measured, was, tolerance);
      problems.push(...said.problems);
      notes.push(...said.notes);
    }
  } finally {
    await client.close();
  }
}
if (!update) for (const id of Object.keys(before)) if (!budget.questions.some((question) => question.id === id)) problems.push(`${id}: a budget for a question nobody asks any more`);

const pad = (value, width) => String(value).padStart(width);
const delta = (now, was) => (was === undefined || now === was ? '' : ` (was ${was})`);
const printTable = () => {
  console.log('Fixed overhead          chars  tokens (est. characters / 4)');
  for (const [part, chars] of Object.entries(fixed)) console.log(`  ${part.padEnd(20)}${pad(chars, 7)}${pad(tokensOf(chars), 7)}${delta(chars, fixedBefore[part])}`);
  const perTurn = fixed.instructions + fixed.guideBlock + fixed.skillDescription;
  console.log(`  ${'every turn'.padEnd(20)}${pad(perTurn, 7)}${pad(tokensOf(perTurn), 7)}  instructions + guide block + skill description`);
  console.log(`  ${'with core tools'.padEnd(20)}${pad(perTurn + fixed.listingCore, 7)}${pad(tokensOf(perTurn + fixed.listingCore), 7)}  once ToolSearch has loaded them`);
  console.log('');
  console.log(`${'Per question'.padEnd(34)}${pad('chars', 7)}${pad('tokens', 7)}${pad('rows', 6)}  complete  calls`);
  let total = 0;
  for (const question of budget.questions) {
    const now = after[question.id];
    total += now.chars;
    console.log(`  ${question.id.padEnd(32)}${pad(now.chars, 7)}${pad(now.tokens, 7)}${pad(now.rows, 6)}  ${(now.complete === null ? '-' : String(now.complete)).padEnd(8)}${pad(now.calls, 7)}${delta(now.chars, before[question.id]?.chars)}`);
  }
  console.log(`  ${'all questions'.padEnd(32)}${pad(total, 7)}${pad(tokensOf(total), 7)}`);
};

if (update) {
  const recorded = Object.fromEntries(budget.questions.map((question) => [question.id, after[question.id]]));
  writeFileSync(budgetPath, `${JSON.stringify({ ...budget, fixed, recorded }, null, 2)}\n`);
}
if (table) printTable();
for (const note of notes) console.log(`    ${note}`);
if (problems.length > 0) {
  for (const problem of problems) console.error(`    ${problem}`);
  console.error(update ? 'Sizes re-recorded; the answers above are still wrong.' : 'An answer that grew for a reason re-records with --update, and its commit says why.');
  process.exit(1);
}
console.log(update ? `answer budget: re-recorded ${budget.questions.length} question(s)` : `answer budget ok: ${budget.questions.length} question(s) within budget`);
