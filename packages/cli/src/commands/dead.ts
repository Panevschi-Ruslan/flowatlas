import { FlowatlasError } from '@flowatlas/core';
import type { Command } from 'commander';
import {
  EXTERNALLY_TRIGGERED,
  deadChannels,
  deadEntries,
  deadFields,
  deadProviders,
  unresolvedInjectCount,
  type DeadOptions,
} from '../analysis/dead.js';
import { maxRows, openProjectDb, print, wantsJson, type ReadOptions } from '../analysis/open.js';
import { ANALYTICS_FORMAT_VERSION, type DeadResult } from '../analysis/shapes.js';
import { moreRows, renderTable, section } from '../format/table.js';

const KINDS = ['entries', 'channels', 'providers', 'fields', 'all'] as const;
type Kind = (typeof KINDS)[number];

export interface DeadCommandOptions extends ReadOptions {
  kind?: string;
  service?: string;
}

export interface DeadRun {
  result: DeadResult;
  lines: string[];
}

/** Keeps the first `max` rows and says how many it dropped. */
const cut = <T>(rows: readonly T[], max: number): { rows: T[]; dropped: number } => ({
  rows: rows.slice(0, max),
  dropped: Math.max(rows.length - max, 0),
});

const where = (row: { file?: string; line?: number }): string =>
  row.file === undefined ? '' : `${row.file}:${row.line ?? 0}`;

/**
 * Everything nothing appears to reach, with the reason it looked that way.
 *
 * Nothing here is a verdict. Four narrow predicates, each of which can be wrong
 * for a reason the graph cannot see — a public API, a handler in a repository
 * the configuration does not list, a provider injected through a token that did
 * not resolve — so the answer is `heuristic` at the top and every row says what
 * was actually checked.
 */
export const runDead = async (options: DeadCommandOptions): Promise<DeadRun> => {
  const kind = (options.kind ?? 'all') as Kind;
  if (!KINDS.includes(kind)) {
    throw new FlowatlasError('bad-argument', `--kind must be one of ${KINDS.join(', ')}, not ${kind}`);
  }

  const { db, close } = openProjectDb(options);
  try {
    const max = maxRows(options);
    const scope: DeadOptions = options.service === undefined ? {} : { service: options.service };
    const report = db.report();
    const wanted = (name: Kind): boolean => kind === 'all' || kind === name;

    const entries = wanted('entries') ? cut(deadEntries(db, report, scope), max) : undefined;
    const channels = wanted('channels') ? cut(deadChannels(db, report, scope), max) : undefined;
    const providers = wanted('providers') ? cut(deadProviders(db, scope), max) : undefined;
    const fields = wanted('fields') ? await deadFields(db, scope) : undefined;
    const fieldRows = fields === undefined ? undefined : cut(fields.fields, max);

    const truncated: Record<string, number> = {};
    if (entries !== undefined && entries.dropped > 0) truncated['entries'] = entries.dropped;
    if (channels !== undefined && channels.dropped > 0) truncated['channels'] = channels.dropped;
    if (providers !== undefined && providers.dropped > 0) truncated['providers'] = providers.dropped;
    if (fieldRows !== undefined && fieldRows.dropped > 0) truncated['fields'] = fieldRows.dropped;

    const warnings = fields?.warning === undefined ? [] : [fields.warning];
    const unresolvedInjects = unresolvedInjectCount(db, options.service);

    const result: DeadResult = {
      analyticsFormatVersion: ANALYTICS_FORMAT_VERSION,
      confidence: 'heuristic',
      ...(entries === undefined ? {} : { entries: entries.rows }),
      ...(channels === undefined ? {} : { channels: channels.rows }),
      ...(providers === undefined ? {} : { providers: providers.rows }),
      ...(fieldRows === undefined ? {} : { fields: fieldRows.rows }),
      excludedEntryKinds: [...EXTERNALLY_TRIGGERED],
      unresolvedInjects,
      ...(warnings.length === 0 ? {} : { warnings }),
      ...(Object.keys(truncated).length === 0 ? {} : { truncated }),
    };

    const lines: string[] = [
      'nothing here is proof: every row is a heuristic with the reason it fired',
    ];
    if (wanted('entries')) {
      lines.push(`entry kinds never reported (triggered from outside): ${EXTERNALLY_TRIGGERED.join(', ')}`);
    }
    if (unresolvedInjects > 0) {
      lines.push(
        `${unresolvedInjects} injects across the project could not be resolved; a provider below may be reached through one`,
      );
    }
    lines.push('');

    if (entries !== undefined) {
      lines.push(
        ...section(
          'entries',
          renderTable(entries.rows, [
            { header: 'id', value: (row) => row.id },
            { header: 'where', value: where },
            { header: 'why', value: (row) => row.reason },
          ]),
        ),
        ...(entries.dropped > 0 ? [`  ${moreRows(entries.dropped)}`] : []),
      );
    }
    if (channels !== undefined) {
      lines.push(
        ...section(
          'channels',
          renderTable(channels.rows, [
            { header: 'channel', value: (row) => row.id },
            { header: 'publishes', value: (row) => row.producers.join(',') || '—' },
            { header: 'handles', value: (row) => row.consumers.join(',') || '—' },
            { header: 'why', value: (row) => row.reason },
          ]),
        ),
        ...(channels.dropped > 0 ? [`  ${moreRows(channels.dropped)}`] : []),
      );
    }
    if (providers !== undefined) {
      lines.push(
        ...section(
          'providers',
          renderTable(providers.rows, [
            { header: 'id', value: (row) => row.id },
            { header: 'where', value: where },
            { header: 'why', value: (row) => row.reason },
          ]),
        ),
        ...(providers.dropped > 0 ? [`  ${moreRows(providers.dropped)}`] : []),
      );
    }
    if (fieldRows !== undefined) {
      lines.push(
        ...section(
          'fields',
          renderTable(fieldRows.rows, [
            { header: 'type', value: (row) => row.typeId },
            { header: 'field', value: (row) => row.field },
            { header: 'sent on', value: (row) => row.sentOn.join(', ') },
          ]),
        ),
        ...(fieldRows.dropped > 0 ? [`  ${moreRows(fieldRows.dropped)}`] : []),
      );
    }
    for (const warning of warnings) lines.push(`warning: ${warning.reason} — ${warning.hint ?? ''}`);

    return { result, lines };
  } finally {
    close();
  }
};

export const registerDead = (program: Command): void => {
  program
    .command('dead')
    .description('entries, channels, providers and fields nothing appears to reach')
    .option('--config <path>', 'configuration file (default: found from the working directory)')
    .option('--db <path>', 'database to read (default: the configured one)')
    .option('--kind <kind>', `one of ${KINDS.join(', ')}`, 'all')
    .option('--service <name>', 'only this service')
    .option('--max <n>', 'most rows per section', '150')
    .option('--format <kind>', 'json or table (default: table)')
    .action(async (options: DeadCommandOptions) => {
      const { result, lines } = await runDead(options);
      print(result, lines, wantsJson(options));
    });
};
