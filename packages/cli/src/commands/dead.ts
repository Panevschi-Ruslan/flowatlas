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

  const { db, close, config } = openProjectDb(options);
  try {
    const max = maxRows(options);
    const publicRoutes = config?.doctor?.publicRoutes ?? [];
    const scope: DeadOptions = {
      ...(options.service === undefined ? {} : { service: options.service }),
      ...(publicRoutes.length === 0 ? {} : { publicRoutes }),
    };
    const report = db.report();
    const wanted = (name: Kind): boolean => kind === 'all' || kind === name;

    const entries = wanted('entries') ? cut(deadEntries(db, report, scope), max) : undefined;
    const channels = wanted('channels') ? cut(deadChannels(db, report, scope), max) : undefined;
    const providers = wanted('providers') ? cut(deadProviders(db, scope), max) : undefined;
    const fields = wanted('fields') ? await deadFields(db, scope) : undefined;
    // Every row of this section is kept in the answer: the whole point of it is
    // that a reader is spared the carried ones, not that they are thrown away.
    // The other sections cut at `--max`, where the rows are all of one kind.
    const fieldRows = fields === undefined ? undefined : { rows: fields.fields, dropped: 0 };

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
      // A field nothing removes is carried, ignored, and depended on by no
      // one: worth a number, not worth a thousand rows. The list holds what the
      // receiving side really throws away and the count says the rest — even
      // where there is no list, which is why the section is told what "none"
      // should say here. Both counts come from the whole answer rather than
      // from what `--max` left, so a truncated list says it was truncated
      // instead of calling its own findings something else.
      const kept = fields?.fields ?? [];
      const stripped = kept.filter((row) => row.dropped);
      const carried = kept.length - stripped.length;
      const shown = stripped.slice(0, max);
      lines.push(
        ...section(
          'fields',
          renderTable(shown, [
            { header: 'type', value: (row) => row.typeId },
            { header: 'field', value: (row) => row.field },
            { header: 'sent on', value: (row) => row.sentOn.join(', ') },
          ]),
          carried === 0
            ? 'none'
            : `none the receiving side removes; ${carried} cross a boundary nothing on the far side declares, and nothing there removes them`,
        ),
        ...(stripped.length > shown.length ? [`  ${moreRows(stripped.length - shown.length)}`] : []),
        ...(carried === 0 || shown.length === 0
          ? []
          : [
              `  ${carried} more field${carried === 1 ? '' : 's'} cross a boundary nothing on the far side declares, and nothing there removes them`,
            ]),
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
