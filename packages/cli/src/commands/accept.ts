/**
 * `flowatlas accept <reason|gap-id>` — say a gap is known, so only new ones show.
 *
 * Writes `accepted.json` beside the database. `doctor` leaves accepted gaps out
 * of its counts and says how many it left out; the page shows them muted; the
 * MCP marks them `accepted: true`. A reason accepts it everywhere, `--service`
 * and `--file` narrow it, and a gap id (`gap:<service>|<file>|<reason>`, as
 * `search` returns it) names one place exactly.
 *
 * A rule (P76) accepts every gap like one: `--file` with a glob, or `--path`
 * with a route pattern, which a route finding is matched on:
 *
 *   flowatlas accept route-unguarded --service catalog --path 'GET /api/public/*' \
 *     --note 'the public catalogue is open by design'
 *
 * A rule goes on accepting rows nobody has looked at, so it must say why
 * (`--note`), and `--dry-run` lists what it would take before it is written.
 *
 * A file that cannot be read is never written over (P80): adding and
 * `--remove` refuse, naming the file and what is wrong with it, and `--list`
 * and `--dry-run` say so first. Reading it as empty and saving one entry used
 * to wipe every other entry and rule in it.
 */
import {
  ACCEPTED_FILE,
  acceptedKeyOf,
  compileAccepted,
  describeAccepted,
  describeAcceptedProblem,
  isGapId,
  isGlob,
  isRule,
  parseGapId,
  readAccepted,
  saveAccepted,
  withAccepted,
  withoutAccepted,
  type AcceptedGap,
  type AcceptedProblem,
  type GapLike,
} from '@flowatlas/core';
import type { Command } from 'commander';
import { dbPathFor, openDbFromOptions, type DbOptions } from '../db.js';
import { cannotRun } from '../exit.js';

export interface AcceptOptions extends DbOptions {
  service?: string;
  file?: string;
  /** A route pattern, `METHOD /path` or `/path`, `*` for any run of characters. */
  path?: string;
  /** List what the target would accept, and write nothing. */
  dryRun?: boolean;
  note?: string;
  remove?: boolean;
  list?: boolean;
  /** Fixed timestamp, for output that is the same on two runs. */
  acceptedAt?: string;
  print?: (message: string) => void;
}

export interface AcceptRun {
  path: string | null;
  accepted: AcceptedGap[];
  /** Why `accepted.json` could not be read, on a `--list` or `--dry-run` that still ran. */
  problem?: AcceptedProblem;
  /** Gaps in the current graph the change covers. */
  covered: number;
  /** On a dry run: what the target would accept, as `file:line  message`. */
  matched?: string[];
}

/** What the argument names, read one way or the other. */
export const targetOf = (argument: string, options: Pick<AcceptOptions, 'service' | 'file' | 'path'>): GapLike => {
  if (isGapId(argument)) {
    const parsed = parseGapId(argument);
    if (parsed === undefined) throw cannotRun(`${JSON.stringify(argument)} is not a gap id (gap:<service>|<file>|<reason>)`);
    return options.path === undefined ? parsed : { ...parsed, path: options.path };
  }
  return {
    reason: argument,
    ...(options.service === undefined ? {} : { service: options.service }),
    ...(options.file === undefined ? {} : { file: options.file }),
    ...(options.path === undefined ? {} : { path: options.path }),
  };
};

const describe = (gap: GapLike): string =>
  [gap.reason, gap.service ?? '*', gap.file ?? '*', ...(gap.path == null ? [] : [gap.path])].join('  ');

/** How many matched rows a dry run lists before it says how many more. */
const DRY_RUN_LIMIT = 20;

/** A rule names more than one place, and must say why it is accepted. */
const isWideRule = (target: GapLike): boolean => target.path != null || (target.file != null && isGlob(target.file));

/** What to do about a file that cannot be read, said after the problem. */
const FIX_HINT = 'Fix or move the file; flowatlas accept --list shows what it holds once it reads.';

/** The stop for a writer handed a file it cannot read: nothing is written over it. */
const refusal = (problem: AcceptedProblem) =>
  cannotRun(`${ACCEPTED_FILE} at ${problem.path} cannot be read (${problem.detail}); nothing was written`, [FIX_HINT]);

export const runAccept = (argument: string | undefined, options: AcceptOptions = {}): AcceptRun => {
  const print = options.print ?? ((message: string) => process.stdout.write(`${message}\n`));
  const dbPath = dbPathFor(options);
  const { gaps: current, problem } = readAccepted(dbPath);
  const withProblem = problem === undefined ? {} : { problem };

  if (options.list === true || argument === undefined) {
    if (problem !== undefined) {
      print(`${describeAcceptedProblem(problem)}.`);
      print(FIX_HINT);
      return { path: null, accepted: current, covered: 0, ...withProblem };
    }
    if (current.length === 0) print('no gap is accepted');
    for (const gap of current) print(`${isRule(gap) ? 'rule  ' : ''}${describe(gap)}  ${gap.note}`);
    return { path: null, accepted: current, covered: 0 };
  }

  const target = targetOf(argument, options);
  // Before the graph is opened: whatever else is wrong, the file comes first.
  if (problem !== undefined && options.dryRun !== true) throw refusal(problem);
  const entry: AcceptedGap = {
    reason: target.reason,
    ...(target.service == null ? {} : { service: target.service }),
    ...(target.file == null ? {} : { file: target.file }),
    ...(target.path == null ? {} : { path: target.path }),
    note: options.note ?? '',
    acceptedAt: options.acceptedAt ?? new Date().toISOString(),
  };
  const db = openDbFromOptions(options);
  let matchedRows: ReturnType<typeof db.allUnresolved>;
  try {
    const rule = compileAccepted([entry]);
    matchedRows = db.allUnresolved().filter((row) => rule.match(row) !== undefined);
  } finally {
    db.close();
  }
  const covered = matchedRows.length;

  if (options.dryRun === true) {
    if (problem !== undefined) print(`${describeAcceptedProblem(problem)}; writing this would be refused.`);
    const matched = matchedRows.map(
      (row) => `${row.service ?? ''}  ${row.file ?? ''}${row.line === null ? '' : `:${row.line}`}  ${row.message}`,
    );
    print(`would accept: ${describeAccepted(target)} (${covered} gap${covered === 1 ? '' : 's'})`);
    for (const line of matched.slice(0, DRY_RUN_LIMIT)) print(`  ${line}`);
    if (matched.length > DRY_RUN_LIMIT) print(`  ... and ${matched.length - DRY_RUN_LIMIT} more`);
    return { path: null, accepted: current, covered, matched, ...withProblem };
  }

  if (options.remove === true) {
    const next = withoutAccepted(current, target);
    if (next.length === current.length) throw cannotRun(`${acceptedKeyOf(target)} is not accepted`);
    const path = saveAccepted(dbPath, next);
    print(`no longer accepted: ${describe(target)} (${covered} gap${covered === 1 ? '' : 's'} show again)`);
    return { path, accepted: next, covered };
  }

  if (covered === 0) {
    throw cannotRun(`no gap in this graph matches ${describeAccepted(target)}`, [
      'Run flowatlas doctor to see the reasons, or search({kinds: ["gaps"]}) in the MCP for gap ids.',
      ...(target.path == null ? [] : ['A route pattern is matched on METHOD /path as the row names it, with :param for a parameter: GET /api/orders/:param, or /api/orders/* for every method.']),
    ]);
  }
  if (isWideRule(target) && (options.note ?? '').trim() === '') {
    throw cannotRun(`a rule accepts gaps nobody has looked at yet, so it needs a reason: add --note "<why>"`, [
      `It would accept ${covered} gap${covered === 1 ? '' : 's'} today; --dry-run lists them.`,
    ]);
  }
  const next = withAccepted(current, entry);
  const path = saveAccepted(dbPath, next);
  print(`accepted: ${describe(target)} (${covered} gap${covered === 1 ? '' : 's'})`);
  print(path);
  return { path, accepted: next, covered };
};

export const registerAccept = (program: Command): void => {
  program
    .command('accept')
    .description('accept a known gap by reason or gap id, or every gap like one by rule, so doctor and the checks show only new ones')
    .argument('[reason-or-id]', 'a reason such as channel-dynamic, or a gap id gap:<service>|<file>|<reason>')
    .option('--config <path>', 'configuration file (default: found from the working directory)')
    .option('--db <path>', 'database to read (default: the configured one)')
    .option('--service <name>', 'accept the reason only in this service')
    .option('--file <path>', 'accept the reason only in this repo-relative file, or in every file a glob names (src/public/**)')
    .option('--path <pattern>', 'accept a route finding on every route a pattern names: "GET /api/public/*", or "/api/public/*" for every method')
    .option('--dry-run', 'list what would be accepted, and write nothing')
    .option('--note <text>', 'why it is accepted')
    .option('--remove', 'stop accepting it')
    .option('--list', 'print what is accepted')
    .action((argument: string | undefined, options: AcceptOptions) => {
      runAccept(argument, options);
    });
};
