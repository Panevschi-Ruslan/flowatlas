/**
 * `flowatlas accept <reason|gap-id>` — say a gap is known, so only new ones show.
 *
 * Writes `accepted.json` beside the database. `doctor` leaves accepted gaps out
 * of its counts and says how many it left out; the page shows them muted; the
 * MCP marks them `accepted: true`. A reason accepts it everywhere, `--service`
 * and `--file` narrow it, and a gap id (`gap:<service>|<file>|<reason>`, as
 * `search` returns it) names one place exactly.
 */
import {
  covers,
  gapIdOf,
  isGapId,
  loadAccepted,
  parseGapId,
  saveAccepted,
  withAccepted,
  withoutAccepted,
  type AcceptedGap,
  type GapLike,
} from '@flowatlas/core';
import type { Command } from 'commander';
import { dbPathFor, openDbFromOptions, type DbOptions } from '../db.js';
import { cannotRun } from '../exit.js';

export interface AcceptOptions extends DbOptions {
  service?: string;
  file?: string;
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
  /** Gaps in the current graph the change covers. */
  covered: number;
}

/** What the argument names, read one way or the other. */
export const targetOf = (argument: string, options: Pick<AcceptOptions, 'service' | 'file'>): GapLike => {
  if (isGapId(argument)) {
    const parsed = parseGapId(argument);
    if (parsed === undefined) throw cannotRun(`${JSON.stringify(argument)} is not a gap id (gap:<service>|<file>|<reason>)`);
    return parsed;
  }
  return {
    reason: argument,
    ...(options.service === undefined ? {} : { service: options.service }),
    ...(options.file === undefined ? {} : { file: options.file }),
  };
};

const describe = (gap: GapLike): string =>
  [gap.reason, gap.service ?? '*', gap.file ?? '*'].join('  ');

export const runAccept = (argument: string | undefined, options: AcceptOptions = {}): AcceptRun => {
  const print = options.print ?? ((message: string) => process.stdout.write(`${message}\n`));
  const dbPath = dbPathFor(options);
  const current = loadAccepted(dbPath);

  if (options.list === true || argument === undefined) {
    if (current.length === 0) print('no gap is accepted');
    for (const gap of current) print(`${describe(gap)}  ${gap.note}`);
    return { path: null, accepted: current, covered: 0 };
  }

  const target = targetOf(argument, options);
  const db = openDbFromOptions(options);
  let covered: number;
  try {
    covered = db.allUnresolved().filter((row) => covers(target, row)).length;
  } finally {
    db.close();
  }

  if (options.remove === true) {
    const next = withoutAccepted(current, target);
    if (next.length === current.length) throw cannotRun(`${gapIdOf(target)} is not accepted`);
    const path = saveAccepted(dbPath, next);
    print(`no longer accepted: ${describe(target)} (${covered} gap${covered === 1 ? '' : 's'} show again)`);
    return { path, accepted: next, covered };
  }

  if (covered === 0) {
    throw cannotRun(`no gap in this graph matches ${gapIdOf(target)}`, [
      'Run flowatlas doctor to see the reasons, or search({kinds: ["gaps"]}) in the MCP for gap ids.',
    ]);
  }
  const entry: AcceptedGap = {
    reason: target.reason,
    ...(target.service == null ? {} : { service: target.service }),
    ...(target.file == null ? {} : { file: target.file }),
    note: options.note ?? '',
    acceptedAt: options.acceptedAt ?? new Date().toISOString(),
  };
  const next = withAccepted(current, entry);
  const path = saveAccepted(dbPath, next);
  print(`accepted: ${describe(target)} (${covered} gap${covered === 1 ? '' : 's'})`);
  print(path);
  return { path, accepted: next, covered };
};

export const registerAccept = (program: Command): void => {
  program
    .command('accept')
    .description('accept a known gap by reason or gap id, so doctor and the checks show only new ones')
    .argument('[reason-or-id]', 'a reason such as dynamic-channel-name, or a gap id gap:<service>|<file>|<reason>')
    .option('--config <path>', 'configuration file (default: found from the working directory)')
    .option('--db <path>', 'database to read (default: the configured one)')
    .option('--service <name>', 'accept the reason only in this service')
    .option('--file <path>', 'accept the reason only in this repo-relative file')
    .option('--note <text>', 'why it is accepted')
    .option('--remove', 'stop accepting it')
    .option('--list', 'print what is accepted')
    .action((argument: string | undefined, options: AcceptOptions) => {
      runAccept(argument, options);
    });
};
