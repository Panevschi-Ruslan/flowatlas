import {
  BOUNDED_BY,
  CONFIDENCE_LEVELS,
  countsOf,
  EDGE_TYPES,
  gapIdOf,
  rowKindOf,
  NODE_TYPES,
  tally,
  wasMissed,
  type BoundedBy,
  type Confidence,
  type EdgeType,
  type NodeType,
  type PlaceCount,
} from '@flowatlas/core';
import type { GraphDb, LinkReport } from '@flowatlas/linker';
import type { Command } from 'commander';
import { questionLogSettings, questionsPathFor, readQuestions } from '@flowatlas/mcp';
import { dbPathFor, handleFor, openDbFromOptions } from '../db.js';
import { cannotRun } from '../exit.js';
import { withQueryOptions, type QueryOptions } from '../options.js';
import { processIo, settingsFor, type QueryIo } from '../query/answer.js';
import { renderQuestions, sinceOf, summariseQuestions } from '../report/questions.js';

/** Enough of the link report for the summary, however it was obtained. */
export interface LinkSummary {
  httpOut?: LinkReport['httpOut'];
  channels: { noConsumers: string[]; noProducers: string[] };
  routes: { total: number; uncalled: string[] };
  /** True when this was worked out from the graph rather than read from the build. */
  recomputed: boolean;
}

export interface Stats {
  /**
   * What the database holds, rows counted by `countsOf` (P81) as the build
   * summary counts them: `missed` gap rows over `sites` places, `notes` and
   * `findings`. `unresolved` equals `missed` and is kept for one version.
   */
  totals: {
    nodes: number;
    edges: number;
    types: number;
    missed: number;
    sites: number;
    notes: number;
    findings: number;
    /** @deprecated since 0.6.0: read `missed`. */
    unresolved: number;
  };
  nodesByType: Record<string, number>;
  nodesByService: Record<string, number>;
  edgesByType: Record<string, number>;
  edgesByConfidence: Record<string, number>;
  /** Rows in the list, by reason. */
  unresolvedByReason: Record<string, number>;
  /**
   * Places those rows stand for, by reason.
   *
   * Equal to the row count for anything a person can act on, and larger for a
   * reason that was folded, which is what keeps a folded reason a number a
   * reader can see rather than a number that quietly went away.
   */
  unresolvedSites: Record<string, number>;
  /**
   * Places where nothing joins, counted apart from every figure above.
   *
   * A template binding that assigns to a field has no other end, so it is not a
   * reason with no answer; it is a place with no question.
   */
  nothing: PlaceCount;
  /**
   * Calls that read as data by the receiver's name alone and that the graph
   * draws as a `static` call into a method of the service's own, where the
   * queries are read (P88): not listed, and counted here so the drop is seen.
   */
  receiversExplainedByEdge: number;
  /**
   * Loops that run a query per item and are bounded on purpose, by why (P89):
   * not listed by doctor, counted here so what was set aside is seen. Summed
   * over the repository nodes, in the order `BOUNDED_BY` lists the reasons.
   */
  loopsBounded: Partial<Record<BoundedBy, number>>;
  link: LinkSummary;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const sortedRecord = (counts: Map<string, number>, order?: readonly string[]): Record<string, number> => {
  const keys = order === undefined ? [...counts.keys()].sort(cmp) : order.filter((key) => counts.has(key));
  return Object.fromEntries(keys.map((key) => [key, counts.get(key) as number]));
};

/**
 * Channels with nobody on one end, and routes nobody calls.
 *
 * The build records all of this, so this is only for a database written before
 * it did, or by a build that failed halfway. Cheap enough that falling back is
 * better than refusing to answer.
 */
const recompute = (db: GraphDb): LinkSummary => {
  const channels = db.nodesByType('channel');
  const routes = db.nodesByType('entry', 'http');
  return {
    channels: {
      noConsumers: channels
        .filter((channel) => db.edgesFrom(channel.id, ['consumes']).length === 0)
        .map((channel) => channel.id),
      noProducers: channels
        .filter((channel) => db.edgesTo(channel.id, ['emits']).length === 0)
        .map((channel) => channel.id),
    },
    routes: {
      total: routes.length,
      uncalled: routes
        .filter((route) => db.edgesTo(route.id, ['http_calls', 'hits']).length === 0)
        .map((route) => route.id),
    },
    recomputed: true,
  };
};

/**
 * What the graph is made of.
 *
 * Every node is visited to count the edges leaving it, which is also how the
 * per-type and per-service breakdowns are had; the alternative is trusting a
 * total the build wrote down, and a total nobody can check is not a statistic.
 */
export const collectStats = (db: GraphDb): Stats => {
  const nodesByType = new Map<string, number>();
  const nodesByService = new Map<string, number>();
  const edgesByType = new Map<string, number>();
  const edgesByConfidence = new Map<string, number>();

  for (const type of NODE_TYPES) {
    const nodes = db.nodesByType(type);
    if (nodes.length > 0) nodesByType.set(type, nodes.length);
    for (const node of nodes) {
      const service = node.repo === '' ? '(project)' : node.repo;
      nodesByService.set(service, (nodesByService.get(service) ?? 0) + 1);
      for (const edge of db.edgesFrom(node.id)) {
        edgesByType.set(edge.type, (edgesByType.get(edge.type) ?? 0) + 1);
        edgesByConfidence.set(edge.confidence, (edgesByConfidence.get(edge.confidence) ?? 0) + 1);
      }
    }
  }

  // Counted the way the build summary counts: by reason, over the rows that say
  // something was not read. Places where nothing joins are their own figure, so
  // that the line at the top adds up to the list under it, and notes and
  // findings are counted by kind and listed in none of the reasons. Every row
  // with its meta, since a kind can depend on it (P89's per-item loops).
  const rows = db.allUnresolved();
  const unresolvedByReason = new Map<string, number>();
  const unresolvedSites = new Map<string, number>();
  const nothingRows: Array<{ sites?: number }> = [];
  for (const row of rows) {
    if (!wasMissed(row)) {
      if (rowKindOf(row) === 'gap') nothingRows.push(row);
      continue;
    }
    unresolvedByReason.set(row.reason, (unresolvedByReason.get(row.reason) ?? 0) + 1);
    unresolvedSites.set(row.reason, (unresolvedSites.get(row.reason) ?? 0) + (row.sites ?? 1));
  }
  const nothing = tally(nothingRows);
  const counted = countsOf(rows);
  // Each reading's own count, on its repository node; absent where none.
  let receiversExplainedByEdge = 0;
  const bounded = new Map<BoundedBy, number>();
  for (const repo of db.nodesByType('repo')) {
    const stats = repo.meta?.['stats'] as Record<string, unknown> | undefined;
    const explained = stats?.['receiversExplainedByEdge'];
    if (typeof explained === 'number') receiversExplainedByEdge += explained;
    const loops = (stats?.['loopsBounded'] ?? {}) as Record<string, unknown>;
    for (const by of BOUNDED_BY) {
      const count = loops[by];
      if (typeof count === 'number') bounded.set(by, (bounded.get(by) ?? 0) + count);
    }
  }
  const loopsBounded = Object.fromEntries(BOUNDED_BY.filter((by) => bounded.has(by)).map((by) => [by, bounded.get(by)]));

  const report = db.report();
  const link: LinkSummary =
    report === undefined
      ? recompute(db)
      : {
          httpOut: report.httpOut,
          channels: { noConsumers: report.channels.noConsumers, noProducers: report.channels.noProducers },
          routes: { total: report.routes.total, uncalled: report.routes.uncalled },
          recomputed: false,
        };

  return {
    // The database counts every row it holds; `unresolved` here means what it
    // means everywhere else — the rows that say something was not read — so a
    // dashboard reading this figure and the build summary sees one number.
    totals: {
      ...db.counts(),
      missed: counted.missed,
      sites: counted.sites,
      notes: counted.notes,
      findings: counted.findings,
      unresolved: counted.missed,
    },
    nodesByType: sortedRecord(nodesByType, NODE_TYPES as readonly NodeType[]),
    nodesByService: sortedRecord(nodesByService),
    edgesByType: sortedRecord(edgesByType, EDGE_TYPES as readonly EdgeType[]),
    edgesByConfidence: sortedRecord(edgesByConfidence, CONFIDENCE_LEVELS as readonly Confidence[]),
    unresolvedByReason: sortedRecord(unresolvedByReason),
    unresolvedSites: sortedRecord(unresolvedSites),
    nothing,
    receiversExplainedByEdge,
    loopsBounded,
    link,
  };
};

const section = (title: string, counts: Record<string, number>): string[] => {
  if (Object.keys(counts).length === 0) return [];
  const width = Math.max(...Object.keys(counts).map((key) => key.length));
  return [
    title,
    ...Object.entries(counts).map(([key, count]) => `  ${key.padEnd(width)}  ${count}`),
  ];
};

const percent = (part: number, whole: number): string =>
  whole === 0 ? 'n/a' : `${Math.round((part / whole) * 100)}%`;

/**
 * Unresolved counted by site, saying where a reason is listed once for many.
 *
 * The site count is the one that compares with any other build, since it does
 * not change when a reason starts being folded. The row count beside it is how
 * long the list actually is.
 */
const unresolvedSection = (stats: Stats): string[] => {
  const reasons = Object.keys(stats.unresolvedSites);
  if (reasons.length === 0) return [];
  const width = Math.max(...reasons.map((reason) => reason.length));
  return [
    'unresolved by reason, counted by site',
    ...reasons.map((reason) => {
      const sites = stats.unresolvedSites[reason] ?? 0;
      const rows = stats.unresolvedByReason[reason] ?? 0;
      const folded = sites === rows ? '' : `  (listed as ${rows} row${rows === 1 ? '' : 's'})`;
      return `  ${reason.padEnd(width)}  ${sites}${folded}`;
    }),
  ];
};

/** `loops set aside: chunk 2 · page 1`, or `none` (P89). */
const loopsSetAside = (counts: Partial<Record<BoundedBy, number>>): string => {
  const parts = BOUNDED_BY.filter((by) => (counts[by] ?? 0) > 0).map((by) => `${by} ${counts[by] ?? 0}`);
  return `loops set aside: ${parts.length === 0 ? 'none' : parts.join(' · ')}`;
};

export const summariseStats = (stats: Stats): string[] => {
  const { totals, link } = stats;
  // In the build summary's words (P81), from a report however old: a Stats
  // written before `missed` existed has `unresolved` alone.
  const rows = totals.missed ?? totals.unresolved;
  const sites = totals.sites ?? rows;
  const unresolved =
    `missed: ${rows}${sites === rows ? '' : ` over ${sites} sites`}` +
    ` · notes: ${totals.notes ?? 0} · findings: ${totals.findings ?? 0}` +
    (stats.nothing.rows === 0
      ? ''
      : ` · ${stats.nothing.sites} site${stats.nothing.sites === 1 ? '' : 's'} with nothing to join`);
  const lines = [
    `${totals.nodes} nodes, ${totals.edges} edges, ${totals.types} types, ${unresolved}`,
    '',
    ...section('nodes by type', stats.nodesByType),
    '',
    ...section('nodes by service', stats.nodesByService),
    '',
    ...section('edges by type', stats.edgesByType),
    '',
    ...section('edges by confidence', stats.edgesByConfidence),
    '',
    ...unresolvedSection(stats),
    `receivers explained by a drawn call: ${stats.receiversExplainedByEdge ?? 0}`,
    loopsSetAside(stats.loopsBounded ?? {}),
    '',
    'link report',
  ];
  if (link.httpOut !== undefined) {
    const { httpOut } = link;
    lines.push(
      `  calls out: ${httpOut.total} total, ${httpOut.linked} linked (${percent(httpOut.linked, httpOut.total)}), ` +
        `${httpOut.noRoute} no route, ${httpOut.unknownEnv} unknown setting, ${httpOut.ambiguous} ambiguous, ` +
        `${httpOut.external} third party, ${httpOut.dynamic} dynamic`,
    );
  }
  lines.push(`  channels with no handler: ${link.channels.noConsumers.length}`);
  for (const id of link.channels.noConsumers) lines.push(`    ${id}`);
  lines.push(`  channels with no publisher: ${link.channels.noProducers.length}`);
  for (const id of link.channels.noProducers) lines.push(`    ${id}`);
  lines.push(`  routes never called: ${link.routes.uncalled.length} of ${link.routes.total}`);
  if (link.recomputed) lines.push('  (worked out from the graph; this build wrote no report)');
  return lines;
};

export interface StatsOptions extends QueryOptions {
  /** What the question log says, instead of what the graph holds (P235). */
  questions?: boolean;
  since?: string;
}

/** The gap ids the graph has now, or undefined when there is no graph to ask. */
const currentGaps = (options: StatsOptions): Set<string> | undefined => {
  const opened = handleFor(options).open();
  if ('error' in opened) return undefined;
  try {
    return new Set(opened.db.allUnresolved().map((row) => gapIdOf({ reason: row.reason, ...(row.service ? { service: row.service } : {}), ...(row.file ? { file: row.file } : {}) })));
  } finally {
    opened.db.close();
  }
};

/** `stats --questions`: the log beside the database, summarised; a log never turned on says how to. */
const runQuestionStats = (options: StatsOptions, format: string, io: QueryIo): void => {
  const since = sinceOf(options.since);
  const dbPath = dbPathFor(options);
  const { entries, unreadable } = readQuestions(dbPath);
  if (entries.length === 0 && unreadable === 0) {
    let enabled = false;
    try {
      enabled = questionLogSettings(handleFor(options).config).enabled;
    } catch {
      // No configuration to read: the environment alone says.
      enabled = questionLogSettings(undefined).enabled;
    }
    io.err(
      enabled
        ? `no questions logged yet in ${questionsPathFor(dbPath)}\n`
        : 'the question log is off: set "log": { "questions": true } in flowatlas.config.json, or FLOWATLAS_LOG_QUESTIONS=1\n',
    );
  }
  const current = currentGaps(options);
  const summary = summariseQuestions(entries, { unreadable, ...(since === undefined ? {} : { since }), ...(current === undefined ? {} : { current }) });
  io.out(format === 'json' ? `${JSON.stringify(summary, null, 2)}\n` : `${renderQuestions(summary).join('\n')}\n`);
};

/** Counts of everything, and the numbers the build wrote down. */
export const runStats = (options: StatsOptions, io: QueryIo = processIo): void => {
  const settings = settingsFor(options, io, ['json', 'tree']);
  if (options.questions === true) {
    runQuestionStats(options, settings.format, io);
    return;
  }
  if (options.since !== undefined) throw cannotRun('--since goes with --questions');
  const db = openDbFromOptions(settings);
  // Closed once counted (P199): on Windows an open database can be neither
  // replaced by the next build nor removed with its directory.
  let stats: ReturnType<typeof collectStats>;
  try {
    stats = collectStats(db);
  } finally {
    db.close();
  }
  io.out(
    settings.format === 'json'
      ? `${JSON.stringify(stats, null, 2)}\n`
      : `${summariseStats(stats).join('\n')}\n`,
  );
};

export const registerStats = (program: Command): void => {
  withQueryOptions(program.command('stats').description('what the built graph is made of'), {
    formats: ['json', 'tree'],
    walks: false,
  })
    .option('--questions', 'what the question log says assistants and commands asked, instead of what the graph holds')
    .option('--since <when>', 'with --questions: from a date, or a span back from now such as 24h, 7d or 2w')
    .action((options: StatsOptions) => {
      runStats(options);
    });
};
