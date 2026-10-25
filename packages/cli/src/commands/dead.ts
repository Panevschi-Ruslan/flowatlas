import { FlowatlasError, observedOver, parseDuration } from '@flowatlas/core';
import type { Command } from 'commander';
import {
  ENTRY_CLASS_NAMES,
  EXTERNALLY_TRIGGERED,
  deadChannels,
  deadEntries,
  deadProviders,
  unresolvedInjectCount,
  type DeadEntry,
  type DeadOptions,
  type EntryClassName,
  type InfrastructureRole,
} from '@flowatlas/linker';
import { deadFields } from '../analysis/dead.js';
import { maxRows, openProjectDb, print, wantsJson, type ReadOptions } from '../analysis/open.js';
import { ANALYTICS_FORMAT_VERSION, type DeadResult } from '../analysis/shapes.js';
import { moreRows, renderTable, section } from '../format/table.js';
import { readObservedBeside } from '../observe/store.js';
import { processIo } from '../query/answer.js';
import {
  deadFindings,
  deliverSarif,
  sarifBound,
  sarifLevelFlag,
  sarifPathsOf,
  toSarif,
  withSarifOptions,
  type SarifFlags,
  type SarifLog,
} from '../sarif/index.js';
import { VERSION } from '../version.js';

const KINDS = ['entries', 'channels', 'providers', 'fields', 'all'] as const;
type Kind = (typeof KINDS)[number];

export interface DeadCommandOptions extends ReadOptions, SarifFlags {
  kind?: string;
  service?: string;
  /** Only entries of this class: `actionable`, `stream`, `infrastructure` or `declared` (P91). */
  class?: string;
  /** The window traffic is read over (P110): `7d`; absent, all the observed file holds. */
  since?: string;
}

export interface DeadRun {
  result: DeadResult;
  lines: string[];
  /** With `--format sarif`: the alerts among the rows, bounded by `--max` (P115). */
  sarif?: SarifLog;
}

/** Keeps the first `max` rows and says how many it dropped. */
const cut = <T>(rows: readonly T[], max: number): { rows: T[]; dropped: number } => ({
  rows: rows.slice(0, max),
  dropped: Math.max(rows.length - max, 0),
});

const where = (row: { file?: string; line?: number }): string =>
  row.file === undefined ? '' : `${row.file}:${row.line ?? 0}`;

/** What traffic says of a row (P110): `seen ×22`, `never in 7d (strong)`, or nothing it can say. */
const seenSaid = (row: { evidence?: DeadEntry['evidence'] }): string => {
  const { seen, neverSeen } = row.evidence ?? {};
  if (seen !== undefined) return `seen ×${seen.count}`;
  if (neverSeen !== undefined) return `never in ${neverSeen.window} (${neverSeen.confidence})`;
  return '—';
};

/** The seen column, only where an observed file was read: without one every table is as it was. */
const seenColumn = <T extends { evidence?: DeadEntry['evidence'] }>(traffic: boolean): Array<{ header: string; value: (row: T) => string }> =>
  traffic ? [{ header: 'seen', value: seenSaid }] : [];

/** What a row says about itself: the rule that put it in its class, and the sentence. */
const entryWhy = (row: DeadEntry): string => (row.class === 'actionable' ? row.reason : `${row.why}: ${row.reason}`);

/**
 * What a row's verdict rests on, one line each under the table (P95): the
 * requests read in part that could reach it (`likely-dead`), and the requests
 * that found no route one segment off it (`unknown`).
 */
const evidenceLines = (rows: readonly DeadEntry[]): string[] =>
  rows.flatMap((row) => [
    ...(row.evidence?.couldHit ?? []).map(
      (miss) => `  ${row.key} could be reached by ${miss.path} at ${where(miss) || miss.call}`,
    ),
    ...(row.evidence?.oneOff ?? []).map(
      (off) => `  ${row.key} is one segment off ${off.asks} at ${where(off) || off.call} (${off.differs})`,
    ),
  ]);

/** How a role is counted on the folded line, singular and plural. */
const ROLE_WORDS: Readonly<Record<InfrastructureRole, [string, string]>> = {
  probe: ['probe', 'probes'],
  webhook: ['webhook', 'webhooks'],
  callback: ['callback', 'callbacks'],
  discovery: ['well-known address', 'well-known addresses'],
  configured: ['named in the configuration', 'named in the configuration'],
};

const counted = (count: number, [one, many]: readonly [string, string]): string =>
  `${count} ${count === 1 ? one : many}`;

/** What each folded class is called on its line. */
const CLASS_WORDS: Readonly<Record<Exclude<EntryClassName, 'actionable'>, [string, string]>> = {
  stream: ['stream route', 'stream routes'],
  infrastructure: ['infrastructure route', 'infrastructure routes'],
  declared: ['route declared public', 'routes declared public'],
};

/**
 * One line per class that is not listed: how many, what they are, and how to
 * list them. `12 infrastructure routes: 6 probes, 5 webhooks, 1 callback`.
 */
const foldedLines = (rows: readonly DeadEntry[]): string[] => {
  const lines: string[] = [];
  for (const name of ['stream', 'infrastructure', 'declared'] as const) {
    const ofClass = rows.filter((row) => row.class === name);
    if (ofClass.length === 0) continue;
    const roles = new Map<InfrastructureRole, number>();
    for (const row of ofClass) if (row.role !== undefined) roles.set(row.role, (roles.get(row.role) ?? 0) + 1);
    const said = [...roles.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .map(([role, count]) => counted(count, ROLE_WORDS[role]));
    lines.push(
      `  ${counted(ofClass.length, CLASS_WORDS[name])}${said.length === 0 ? '' : `: ${said.join(', ')}`} — --class ${name} to list`,
    );
  }
  return lines;
};

/**
 * Everything nothing appears to reach, with the reason it looked that way.
 *
 * Four narrow predicates, each of which can be wrong for a reason the graph
 * cannot see — a public API, a handler in a repository the configuration does
 * not list, a provider injected through a token that did not resolve — so the
 * answer is `heuristic` at the top, and every row says what was checked and
 * the verdict it comes to (P95): `dead`, `likely-dead` with the request read in
 * part that could reach it, or `unknown` with what is outside or the request
 * one segment off it. The predicates are the linker's, which the MCP server's
 * `dead` tool reads too.
 */
export const runDead = async (options: DeadCommandOptions): Promise<DeadRun> => {
  const kind = (options.kind ?? 'all') as Kind;
  if (!KINDS.includes(kind)) {
    throw new FlowatlasError('bad-argument', `--kind must be one of ${KINDS.join(', ')}, not ${kind}`);
  }

  const sarifLevel = sarifLevelFlag(options.sarifLevel);
  const only = options.class as EntryClassName | undefined;
  if (only !== undefined && !ENTRY_CLASS_NAMES.includes(only)) {
    throw new FlowatlasError('bad-argument', `--class must be one of ${ENTRY_CLASS_NAMES.join(', ')}, not ${only}`);
  }

  if (options.since !== undefined && options.since !== 'all' && parseDuration(options.since) === undefined) {
    throw new FlowatlasError('bad-argument', `--since takes hours, days or weeks (2h, 7d, 2w), not ${options.since}`);
  }

  const { db, close, config, path } = openProjectDb(options);
  try {
    const max = maxRows(options);
    const publicRoutes = config?.doctor?.publicRoutes ?? [];
    const infrastructure = config?.dead?.infrastructure;
    // Traffic is evidence for every verdict when an observed file sits beside
    // the database (P110); without one the answer is exactly the static one.
    const observed = readObservedBeside(path).observed;
    if (observed === undefined && options.since !== undefined) {
      throw new FlowatlasError('bad-argument', '--since reads the observed file beside the database, and there is none', 'Run flowatlas observe <trace files> first.');
    }
    const since = options.since === undefined || options.since === 'all' ? undefined : options.since;
    const scope: DeadOptions = {
      ...(options.service === undefined ? {} : { service: options.service }),
      ...(publicRoutes.length === 0 ? {} : { publicRoutes }),
      ...(infrastructure === undefined ? {} : { infrastructure }),
      ...(observed === undefined ? {} : { observed }),
      ...(since === undefined ? {} : { since }),
    };
    const traffic = observed !== undefined;
    const report = db.report();
    const wanted = (name: Kind): boolean => kind === 'all' || kind === name;

    // Every class is read so the folded lines can count what is not listed;
    // `--class` narrows what is listed and answered.
    const allEntries = wanted('entries') ? deadEntries(db, report, scope) : undefined;
    const listedEntries =
      allEntries === undefined ? undefined : only === undefined ? allEntries : allEntries.filter((row) => row.class === only);
    const entries = listedEntries === undefined ? undefined : cut(listedEntries, max);
    const allChannels = wanted('channels') ? deadChannels(db, report, scope) : undefined;
    const allProviders = wanted('providers') ? deadProviders(db, scope) : undefined;
    const channels = allChannels === undefined ? undefined : cut(allChannels, max);
    const providers = allProviders === undefined ? undefined : cut(allProviders, max);
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
    if (observed !== undefined) {
      const { window } = observedOver(observed, since);
      lines.push(
        `traffic over ${window.label}${window.short ? ` (the file holds less than ${since ?? ''} asked)` : ''}: ` +
          'seen is alive whatever the code says; never seen is strong only beside a busy neighbour',
      );
    }
    lines.push('');

    if (allEntries !== undefined) {
      // Without `--class` the table holds the actionable rows and every other
      // class is one line saying how many and how to list them (P91); with it,
      // the table holds that class.
      const listed = (only === undefined ? allEntries.filter((row) => row.class === 'actionable') : (listedEntries ?? []));
      const shown = listed.slice(0, max);
      lines.push(
        ...section(
          'entries',
          renderTable(shown, [
            { header: 'id', value: (row) => row.id },
            { header: 'where', value: where },
            { header: 'verdict', value: (row) => row.verdict },
            ...seenColumn<DeadEntry>(traffic),
            { header: 'why', value: entryWhy },
          ]),
        ),
        ...(listed.length > shown.length ? [`  ${moreRows(listed.length - shown.length)}`] : []),
        ...evidenceLines(shown),
        ...(only === undefined ? foldedLines(allEntries) : []),
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
            { header: 'verdict', value: (row) => row.verdict },
            ...seenColumn<(typeof channels.rows)[number]>(traffic),
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
            { header: 'verdict', value: (row) => row.verdict },
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

    // The alerts among every row rather than among the rows `--max` left, so
    // the log's own bound is the only cut, and it is said (P115).
    const sarif =
      options.format === 'sarif'
        ? toSarif({
            command: 'dead',
            version: VERSION,
            findings: deadFindings(
              {
                ...(listedEntries === undefined ? {} : { entries: listedEntries }),
                ...(allChannels === undefined ? {} : { channels: allChannels }),
                ...(allProviders === undefined ? {} : { providers: allProviders }),
                ...(fields === undefined ? {} : { fields: fields.fields }),
              },
              db,
            ),
            paths: sarifPathsOf(options, options.sarifRoot),
            maxResults: sarifBound(options.max === undefined ? undefined : max),
            ...(sarifLevel === undefined ? {} : { minLevel: sarifLevel }),
            notes: warnings.map((warning) => ({ level: 'warning' as const, text: `${warning.reason}: ${warning.hint ?? ''}` })),
          })
        : undefined;

    return { result, lines, ...(sarif === undefined ? {} : { sarif }) };
  } finally {
    close();
  }
};

export const registerDead = (program: Command): void => {
  const command = program
    .command('dead')
    .description('entries, channels, providers and fields nothing appears to reach')
    .option('--config <path>', 'configuration file (default: found from the working directory)')
    .option('--db <path>', 'database to read (default: the configured one)')
    .option('--kind <kind>', `one of ${KINDS.join(', ')}`, 'all')
    .option('--class <class>', `only entries of one class: ${ENTRY_CLASS_NAMES.join(', ')}`)
    .option('--service <name>', 'only this service')
    .option('--since <dur>', 'with an observed file: read traffic over the last 2h, 7d, 2w of it (default: all it holds)')
    .option('--max <n>', 'most rows per section (default 150; with --format sarif, most results, default 5000)')
    .option('--format <kind>', 'json, table or sarif (default: table)');
  withSarifOptions(command).action(async (options: DeadCommandOptions) => {
    const { result, lines, sarif } = await runDead(options);
    if (sarif !== undefined) deliverSarif(sarif, options, processIo);
    else print(result, lines, wantsJson(options));
  });
};
