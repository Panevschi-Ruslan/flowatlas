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
 * `recorded`, the sizes. A tool that answers plain text (`get_source`,
 * `describe_for_prompt`, P382) is measured by its text, and what it must say
 * is written as `says`, strings the text holds. The rules are
 * `answer-budget-rules.mjs`.
 *
 * Claude Code hands the model `JSON.stringify(structuredContent)` on a
 * success, so every success answer's text must be exactly that, or what is
 * measured here is not what the model reads (P382); it fails otherwise.
 *
 * It fails when an answer, or a part of the fixed overhead, grows past its
 * recorded size by more than 10% or 300 characters, whichever is larger; when
 * a list misses an id it must hold or holds one it must not; when an answer
 * says `complete: false` where the right answer is complete; and when a
 * question answered complete takes more than one call, or names the same
 * call asked further in `next` (P376). A change that grows
 * an answer re-records with `--update` and says why in its commit.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createFlowatlasServer, INSTRUCTIONS_MAX } from '@flowatlas/mcp';
import { loadConfig } from '@flowatlas/core';
import { ALWAYS_LOAD_KEY, CORE_TOOLS, UPFRONT_LISTING_MAX } from '@flowatlas/mcp';
import { guideDescription, missingCandidatesFor, promptCard, readCardNamesAt, reasonCatalog, sharedBlock } from '../packages/cli/dist/index.js';
import { asksFurther, ceilingOf, followOn, overBudget, rowsByList, tokensOf, wrongIn } from './answer-budget-rules.mjs';

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
 * turn; and the listing a model reads, for the core tools the server lists to
 * load upfront (P380: read every turn too), the tools the project is offered,
 * and all of them. `listingCore` is measured on the tools the listing marks
 * `anthropic/alwaysLoad`, which must be exactly `CORE_TOOLS`.
 */
const measureFixed = async () => {
  const fixture = join(root, 'fixtures', budget.fixedOn);
  const plain = await connect(fixture);
  const all = await connect(fixture, { allTools: true });
  // Started on a database alone (`flowatlas mcp --db`): no code served, its own last line (P382).
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createFlowatlasServer({ dbPath: join(fixture, '.flowatlas', 'graph.db'), toolsPollMs: 0 }).connect(serverSide);
  const db = new Client({ name: 'answer-budget', version: '0' });
  await db.connect(clientSide);
  try {
    const listed = (await plain.listTools()).tools;
    const every = (await all.listTools()).tools;
    const { config } = loadConfig(join(fixture, 'flowatlas.config.json'), { checkRepos: false });
    const services = config.services.map((service) => ({ name: service.name, type: service.type }));
    const guide = { services, here: [services[0].name] };
    return {
      instructions: plain.getInstructions()?.length ?? 0,
      instructionsDb: db.getInstructions()?.length ?? 0,
      guideBlock: sharedBlock(guide).length,
      // CLAUDE.md where .mcp.json registers the server: read beside its instructions (P382).
      guideBlockClaude: sharedBlock({ ...guide, registered: true }, 'claude-md').length,
      skillDescription: guideDescription(guide).length,
      listingCore: modelVisible(every.filter((tool) => tool._meta?.[ALWAYS_LOAD_KEY] === true)).length,
      upfront: every.filter((tool) => tool._meta?.[ALWAYS_LOAD_KEY] === true).map((tool) => tool.name),
      listingDefault: modelVisible(listed).length,
      listingAll: modelVisible(every).length,
    };
  } finally {
    await plain.close();
    await all.close();
    await db.close();
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
    // A plain-text answer (P382) has no structured content; any other success is its structured content, as text.
    if (response.structuredContent !== undefined && text !== JSON.stringify(response.structuredContent)) mismatched.push(question.id);
    const parsed = response.structuredContent === undefined && response.isError !== true && !text.startsWith('{') ? { text } : JSON.parse(text);
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

/**
 * A question asked as a prompt (P386): the prompt card the prompt hook hands
 * the model before its first turn, read at the graph's build time. No tool is
 * called, so `calls` is 0; `rows` counts the names it answers for. Right is
 * written by hand: `cards`, exactly the calls whose answers the card holds,
 * and `mentions`, ids it must hold; `silent` a prompt that gets no card.
 */
const askCard = async (question) => {
  const cardsPath = join(root, 'fixtures', question.fixture, '.flowatlas', 'card-names.json');
  const index = readCardNamesAt(cardsPath);
  if (index === undefined) return { wrong: [`no card name index at ${cardsPath}: build the fixture`], measured: { chars: 0, tokens: 0, rows: 0, complete: null, calls: 0 } };
  const card = await promptCard(question.prompt, cardsPath, { index, now: Date.parse(index.builtAt) });
  const chars = card.text?.length ?? 0;
  const expect = question.expect ?? {};
  const wrong = [];
  if (expect.silent === true && card.text !== undefined) wrong.push('a card where the prompt names nothing the graph holds');
  if (expect.cards !== undefined && JSON.stringify(card.calls) !== JSON.stringify(expect.cards)) wrong.push(`the card answers ${JSON.stringify(card.calls)}, not ${JSON.stringify(expect.cards)}`);
  for (const id of expect.mentions ?? []) if (!(card.text ?? '').includes(id)) wrong.push(`the card does not name ${id}`);
  return { wrong, measured: { chars, tokens: tokensOf(chars), rows: card.keys.length, complete: null, calls: 0 } };
};

const problems = [];
const notes = [];
const mismatched = [];
const before = budget.recorded ?? {};
const after = {};
const fixedBefore = budget.fixed ?? {};
const { upfront, ...fixed } = await measureFixed();
// The upfront set is the core set, and its listing fits the ceiling written by hand (P380), whatever was recorded.
if ([...upfront].sort().join() !== [...CORE_TOOLS].sort().join()) problems.push(`the tools listed to load upfront (${upfront.join(', ')}) are not the core tools (${CORE_TOOLS.join(', ')})`);
// Every variant of the instructions within their ceiling (P382): a server on a database alone sent 2,535.
for (const part of ['instructions', 'instructionsDb']) if (fixed[part] > INSTRUCTIONS_MAX) problems.push(`fixed ${part}: ${fixed[part]} characters, past INSTRUCTIONS_MAX (${INSTRUCTIONS_MAX})`);
if (fixed.listingCore > UPFRONT_LISTING_MAX) problems.push(`fixed listingCore: ${fixed.listingCore} characters, past UPFRONT_LISTING_MAX (${UPFRONT_LISTING_MAX}): the upfront tools are sent on every turn`);
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
      if (question.prompt !== undefined) {
        const carded = await askCard(question);
        after[question.id] = carded.measured;
        for (const wrong of carded.wrong) problems.push(`${question.id}: ${wrong}`);
      } else {
        const result = await ask(client, question);
        after[question.id] = result.measured;
        for (const wrong of wrongIn(question.expect ?? {}, result)) problems.push(`${question.id}: ${wrong}`);
        const further = asksFurther(question.tool, question.args, result.first);
        if (further !== undefined) problems.push(`${question.id}: ${further}`);
      }
      if (update) continue;
      const was = before[question.id];
      if (was === undefined) {
        problems.push(`${question.id}: no budget; run node scripts/answer-budget.mjs --update`);
        continue;
      }
      const said = overBudget(question.id, after[question.id], was, tolerance);
      problems.push(...said.problems);
      notes.push(...said.notes);
    }
  } finally {
    await client.close();
  }
}
for (const id of mismatched) problems.push(`${id}: the text is not JSON.stringify(structuredContent), what Claude Code hands the model`);
if (!update) for (const id of Object.keys(before)) if (!budget.questions.some((question) => question.id === id)) problems.push(`${id}: a budget for a question nobody asks any more`);

const pad = (value, width) => String(value).padStart(width);
const delta = (now, was) => (was === undefined || now === was ? '' : ` (was ${was})`);
const printTable = () => {
  console.log('Fixed overhead          chars  tokens (est. characters / 4)');
  for (const [part, chars] of Object.entries(fixed)) console.log(`  ${part.padEnd(20)}${pad(chars, 7)}${pad(tokensOf(chars), 7)}${delta(chars, fixedBefore[part])}`);
  const perTurn = fixed.instructions + fixed.guideBlock + fixed.skillDescription + fixed.listingCore;
  console.log(`  ${'every turn'.padEnd(20)}${pad(perTurn, 7)}${pad(tokensOf(perTurn), 7)}  instructions + guide block + skill description + core tools, upfront`);
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
