#!/usr/bin/env node
/**
 * The benchmark's report (P238): `docs/benchmark.md` from a run's results.
 *
 *   node scripts/bench-agent/report.mjs <results dir> [--out docs/benchmark.md] [--readme]
 *   node scripts/bench-agent/report.mjs --method-only
 *
 * Every figure comes from `sessions.jsonl`; every version from `run.json`. It
 * refuses without `expectations.md`, and it compares the results with every
 * claim there, held or not. The questions where an arm with the graph did
 * worse than search with every repository open are listed one by one, with
 * the reason a person read from the transcript (`notes.json` in the results
 * directory, `{ "<question>": "why" }`); one not yet read says so.
 *
 * `--readme` also writes the headline into README.md, between its benchmark
 * markers, quoted from this report only.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARMS, EXPECTATIONS, median, readSessions } from './run.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const DOC = join(ROOT, 'docs', 'benchmark.md');
const README = join(ROOT, 'README.md');
const START = '<!-- benchmark:start -->';
const END = '<!-- benchmark:end -->';

export const KINDS = ['cross-repo-callers', 'blast-radius', 'event-handlers', 'dead', 'contract', 'settings', 'single-repo', 'code-text', 'explain'];
const ACROSS = new Set(['cross-repo-callers', 'blast-radius', 'event-handlers', 'dead']);
const MEASURES = { score: (session) => session.score, calls: (session) => session.toolCalls, tokens: (session) => session.tokens.total, time: (session) => session.ms };

/** The claims of `expectations.md`'s block, one per line: `[measure] kind: X op Y`. */
export const readClaims = (text) => {
  const block = /```expectations\n([\s\S]*?)```/.exec(text);
  if (block === null) return [];
  return block[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => {
      const match = /^(?:(calls|tokens|time)\s+)?([\w-]+):\s*([A-D])\s*(>=|<=|>|<|=)\s*([A-D])$/.exec(line);
      if (match === null) throw new Error(`expectations.md: cannot read ${JSON.stringify(line)}`);
      return { line, measure: match[1] ?? 'score', kind: match[2], left: match[3], op: match[4], right: match[5] };
    });
};

/** Whether a claim held: a score by 0.1, a measure by 10% of the larger. */
export const judge = (claim, sessions) => {
  const of = (arm) => sessions.filter((session) => session.kind === claim.kind && session.arm === arm).map(MEASURES[claim.measure]);
  const left = of(claim.left);
  const right = of(claim.right);
  if (left.length === 0 || right.length === 0) return { ...claim, held: null, why: 'no sessions' };
  const a = median(left);
  const b = median(right);
  const margin = claim.measure === 'score' ? 0.1 : 0.1 * Math.max(Math.abs(a), Math.abs(b));
  const held = { '>': a > b + margin, '<': a < b - margin, '=': Math.abs(a - b) <= margin, '>=': a >= b - margin, '<=': a <= b + margin }[claim.op];
  return { ...claim, held, a, b };
};

const shown = (measure, value) => (measure === 'score' ? value.toFixed(2) : measure === 'time' ? `${Math.round(value / 1000)}s` : String(Math.round(value)));

/** The row of one kind and arm: score median and range, share fully right, and the costs. */
const cell = (sessions) => {
  if (sessions.length === 0) return '—';
  const scores = sessions.map((session) => session.score);
  const right = sessions.filter((session) => session.correct).length;
  return `${median(scores).toFixed(2)} (${Math.min(...scores).toFixed(2)}–${Math.max(...scores).toFixed(2)}) · ${right}/${sessions.length} · ${median(sessions.map((session) => session.toolCalls))} calls · ${Math.round(median(sessions.map((session) => session.tokens.total)) / 1000)}k tok · ${Math.round(median(sessions.map((session) => session.ms)) / 1000)}s`;
};

const METHOD = `## How it is measured

A generated project of eight TypeScript repositories - a NestJS gateway, three
NestJS services, an Express service, Lambda functions declared in Terraform, a
React storefront and an Angular back office, and a package of shared types -
is asked 30 fixed questions (\`scripts/bench-agent/questions.yaml\`). The
answers are marked against a key the generator writes from its own model of
what it generated, never from flowatlas's reading of it. The project has
traps: routes nothing calls, an event nobody handles, a call made through a
helper, an address read from a settings object, a field renamed across a
boundary.

| Arm | Workspace | flowatlas |
|---|---|---|
| A | every repository side by side | none |
| B | the repository the question is asked from | none |
| C | that repository | the graph of all of them over MCP, and the guide |
| D | every repository | the graph over MCP, and the guide |

A is search's best case and B its usual one; C is what one person in one
repository gets; D isolates what the graph adds when search sees everything
too. Every arm has the same model, the same prompt and the same tools for
reading and searching, in a fresh copy of its workspace; the person's own
settings, hooks and MCP servers are left out. Each question runs at least
three times an arm, and the tables give the median and the range. The kinds
where the graph should not help - one repository's own code, a constant, what
a method does - are asked and reported like the rest. What was expected was
written down before the first run (\`scripts/bench-agent/expectations.md\`) and
is compared below.

## Run it yourself

\`\`\`sh
pnpm install && pnpm -r build
node scripts/bench-agent/run.mjs --pilot        # 32 sessions; prints what a full run would take
node scripts/bench-agent/run.mjs --full --yes   # after the pilot
node scripts/bench-agent/report.mjs scripts/bench-agent/results/<the run>
\`\`\`

It drives Claude Code in print mode on the account you are signed in with,
so it spends that account's usage. A run stopped by a usage limit goes on
with \`--resume <the run>\`. \`node scripts/bench-agent/run.mjs --dry\` checks the
generator, the key and the scorers with no assistant at all, and is part of
\`pnpm check\`.
`;

export const renderReport = ({ run, sessions, claims, notes, dir }) => {
  const lines = ['# Does flowatlas help an assistant? Measured', ''];
  lines.push(
    `Run \`${basename(dir)}\`: flowatlas ${run.flowatlas.version} (${run.flowatlas.commit}), ${run.assistant.name} ${run.assistant.version ?? ''}, model ${run.model ?? run.modelRequested}, seed ${run.seed}, ${run.reps} run${run.reps === 1 ? '' : 's'} a question an arm, ${run.started.slice(0, 10)}${run.kind === 'pilot' ? '. **A pilot**: one run each, eight questions, for the estimate; not a result to quote.' : '.'}`,
    '',
  );
  lines.push(METHOD, '## Results by kind', '', 'Each cell: median score (range) · fully right · median tool calls · tokens · time.', '');
  lines.push(`| Kind | ${run.arms.join(' | ')} |`, `|---|${run.arms.map(() => '---').join('|')}|`);
  for (const kind of KINDS) {
    const mine = sessions.filter((session) => session.kind === kind);
    if (mine.length === 0) continue;
    lines.push(`| ${kind} | ${run.arms.map((arm) => cell(mine.filter((session) => session.arm === arm))).join(' | ')} |`);
  }
  lines.push('', '## What was expected', '');
  const judged = claims.map((claim) => judge(claim, sessions));
  for (const claim of judged) {
    const said = claim.held === null ? 'not measured in this run' : `${claim.held ? 'held' : '**did not hold**'}: ${shown(claim.measure, claim.a)} against ${shown(claim.measure, claim.b)}`;
    lines.push(`- \`${claim.line}\` ${said}`);
  }
  lines.push('', '## Where the graph did worse', '');
  const worse = [];
  for (const question of [...new Set(sessions.map((session) => session.question))]) {
    const of = (arm) => sessions.filter((session) => session.question === question && session.arm === arm).map((session) => session.score);
    const a = of('A');
    if (a.length === 0) continue;
    for (const arm of ['C', 'D']) {
      const mine = of(arm);
      if (mine.length > 0 && median(mine) < median(a)) worse.push({ question, arm, a: median(a), b: median(mine) });
    }
  }
  if (worse.length === 0) lines.push('No question scored lower with the graph than with every repository open and search alone.');
  for (const row of worse) lines.push(`- **${row.question}**, arm ${row.arm}: ${row.b.toFixed(2)} against A's ${row.a.toFixed(2)}. Why: ${notes[row.question] ?? 'not yet read from the transcript.'}`);
  const outcomes = new Map();
  for (const session of sessions) {
    const key = session.outcome === 'answered' ? `answered, read by ${session.by}` : session.outcome;
    outcomes.set(key, (outcomes.get(key) ?? 0) + 1);
  }
  lines.push('', '## Every session', '', ...[...outcomes].sort().map(([outcome, count]) => `- ${outcome}: ${count}`), '');
  return { text: `${lines.join('\n')}\n`, judged, worse };
};

/** The README's lines, quoted from the report: the questions across repositories, then the ones about one. */
export const headline = ({ run, sessions }) => {
  const share = (kinds, arm) => {
    const mine = sessions.filter((session) => kinds(session.kind) && session.arm === arm);
    return mine.length === 0 ? undefined : { right: mine.filter((session) => session.correct).length, of: mine.length, tokens: median(mine.map((session) => session.tokens.total)) };
  };
  const across = (kind) => ACROSS.has(kind);
  const local = (kind) => ['single-repo', 'code-text', 'explain'].includes(kind);
  const say = (figures) => (figures === undefined ? 'not run' : `${figures.right} of ${figures.of} fully right`);
  return [
    `Measured with ${run.assistant.name} and ${run.model ?? run.modelRequested} on a generated eight-repository project (flowatlas ${run.flowatlas.version}, run ${basename(run.dir ?? '')}):`,
    '',
    `- Questions across repositories, from one repository: ${say(share(across, 'C'))} with flowatlas, ${say(share(across, 'B'))} without.`,
    `- The same, with every repository open: ${say(share(across, 'D'))} with flowatlas, ${say(share(across, 'A'))} without.`,
    `- Questions about one repository's own code: ${say(share(local, 'C'))} with flowatlas, ${say(share(local, 'B'))} without.`,
    '',
    'The method, every kind of question, and where it did worse: [docs/benchmark.md](docs/benchmark.md).',
  ].join('\n');
};

const methodOnly = () =>
  `# Does flowatlas help an assistant? Measured\n\nNo run has been recorded yet. The benchmark is built and checked (\`run.mjs --dry\` is in \`pnpm check\`); the figures appear here after the first full run, with the expectations they are compared against already committed.\n\n${METHOD}`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const outAt = argv.indexOf('--out');
  const out = outAt === -1 ? DOC : resolve(argv[outAt + 1]);
  if (!existsSync(EXPECTATIONS)) {
    process.stderr.write('scripts/bench-agent/expectations.md is missing: no report without the expectations written before the run\n');
    process.exit(2);
  }
  if (argv.includes('--method-only')) {
    writeFileSync(out, methodOnly());
    process.stdout.write(`wrote ${out}\n`);
  } else {
    const dir = resolve(argv.find((arg, index) => !arg.startsWith('--') && argv[index - 1] !== '--out') ?? '');
    if (!existsSync(join(dir, 'run.json'))) {
      process.stderr.write('usage: report.mjs <results dir> [--out <file>] [--readme], or --method-only\n');
      process.exit(2);
    }
    const run = { ...JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')), dir };
    const sessions = readSessions(dir);
    const notes = existsSync(join(dir, 'notes.json')) ? JSON.parse(readFileSync(join(dir, 'notes.json'), 'utf8')) : {};
    const report = renderReport({ run, sessions, claims: readClaims(readFileSync(EXPECTATIONS, 'utf8')), notes, dir });
    writeFileSync(out, report.text);
    process.stdout.write(`wrote ${out}: ${sessions.length} sessions, ${report.judged.filter((claim) => claim.held === true).length} of ${report.judged.length} expectations held, ${report.worse.length} questions worse with the graph\n`);
    if (argv.includes('--readme')) {
      if (run.kind !== 'full') {
        process.stderr.write('the README quotes a full run only, not a pilot\n');
        process.exit(2);
      }
      const readme = readFileSync(README, 'utf8');
      const at = readme.indexOf(START);
      const end = readme.indexOf(END);
      if (at === -1 || end === -1) {
        process.stderr.write(`README.md has no ${START} ... ${END} markers\n`);
        process.exit(2);
      }
      writeFileSync(README, `${readme.slice(0, at + START.length)}\n${headline({ run, sessions })}\n${readme.slice(end)}`);
      process.stdout.write('wrote the headline into README.md\n');
    }
  }
}

export { ARMS };
