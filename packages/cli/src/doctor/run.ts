/**
 * The health check itself: five questions asked of one built graph.
 *
 * Nothing here reads a repository. Everything it says comes from the graph, the
 * report the build wrote beside it and the baseline, which is what makes it
 * cheap enough to run on every push and what makes its answer reproducible: two
 * runs over one graph say the same thing, so a difference in CI is a difference
 * in the project.
 */
import type { GraphNode, Unresolved } from '@flowatlas/core';
import { checkContracts, type CheckOptions } from '@flowatlas/contracts';
import { summarizeForDoctor } from '@flowatlas/contracts';
import type { GraphDb } from '@flowatlas/linker';
import {
  compareBaseline,
  isProblem,
  snapshotOf,
  type BaselineRead,
  type UnresolvedSnapshot,
} from './baseline.js';
import { hintFor, isKnownReason, type HintContext } from './hints.js';
import { validateMarkers, type MarkerIssue } from './markers.js';
import {
  DOCTOR_FORMAT_VERSION,
  SECTIONS,
  type DesyncRow,
  type DoctorReport,
  type DoctorRow,
  type ReasonGroup,
  type Section,
  type SectionStatus,
} from './schema.js';

/** What the graph and the file beside it hand over. */
export interface DoctorInput {
  db: GraphDb;
  /**
   * Rows as the graph recorded them.
   *
   * Read from `project-graph.json` when it belongs to this build, because the
   * database drops the symbol each row names and two methods failing for the
   * same reason in one file would then be one row to the baseline.
   */
  unresolved: readonly Unresolved[];
  /** Said in the report when the rows had to be taken from the database. */
  note?: string;
}

export interface DoctorSettings {
  strict?: boolean;
  /** Which sections to run. Defaults to all five. */
  sections?: readonly Section[];
  /** Narrow everything to one service. */
  service?: string;
  /** Most rows printed per section; the file on disk is always complete (I9). */
  maxNodes?: number;
  /** False for `--no-contracts`. */
  contracts?: boolean;
  /** The baseline as it was read, or undefined when the check was not run. */
  baseline?: BaselineRead;
  baselinePath?: string | null;
  /** Reasons taken out of the growth check, still printed. */
  ignoreReasons?: readonly string[];
  /** Treat a marker warning as an error, from `doctor.markers.warnAsError`. */
  warnAsError?: boolean;
  /** Passed through to the contract check. */
  check?: CheckOptions;
  /** Which services claim each settings key, from the configuration. */
  envOwners?: ReadonlyMap<string, readonly string[]>;
  /** Fixed timestamp, for reproducible output. */
  generatedAt?: string;
  flowatlasVersion?: string;
}

/** The reasons that mean a call does not land where it was aimed. */
const DESYNC_REASONS: ReadonlySet<string> = new Set([
  'unknown-base-url-env',
  'target-route-not-found',
  'ambiguous-route',
  'ambiguous-route-target',
  'route-wildcard-only',
]);

const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The sentence most of them say, with ties broken by which reads first. */
const commonest = (values: readonly string[]): string => {
  const counted = new Map<string, number>();
  for (const value of values) counted.set(value, (counted.get(value) ?? 0) + 1);
  let best = '';
  let most = 0;
  for (const [value, count] of [...counted.entries()].sort((a, b) => cmp(a[0], b[0]))) {
    if (count > most) {
      best = value;
      most = count;
    }
  }
  return best;
};

/** Rows kept and rows cut, so a cut is always a number somebody can see. */
const cut = <T>(all: readonly T[], max: number): { rows: T[]; truncated?: number } => {
  if (all.length <= max) return { rows: [...all] };
  return { rows: all.slice(0, max), truncated: all.length - max };
};

/**
 * Every row of one reason, grouped, with the advice they share.
 *
 * Actionable reasons come first and the biggest within each half, because the
 * top of the list is what gets read and the informational half is there to be
 * seen rather than worked through.
 */
const groupByReason = (
  rows: readonly Unresolved[],
  contextOf: (row: Unresolved) => HintContext,
  ignore: ReadonlySet<string>,
  maxNodes: number,
): { groups: ReasonGroup[]; unknown: string[] } => {
  const byReason = new Map<string, Unresolved[]>();
  for (const row of rows) {
    const list = byReason.get(row.reason);
    if (list === undefined) byReason.set(row.reason, [row]);
    else list.push(row);
  }

  const unknown: string[] = [];
  const groups: ReasonGroup[] = [];
  for (const [reason, list] of byReason) {
    const known = isKnownReason(reason);
    if (!known) unknown.push(reason);
    const level = list.some((row) => (row.level ?? 'action') === 'action') ? 'action' : 'info';
    const drawn: DoctorRow[] = list.map((row) => ({
      service: row.service ?? '',
      file: row.file,
      line: row.line,
      symbol: row.symbol ?? null,
      level: (row.level ?? 'action') as 'action' | 'info',
      sites: row.sites ?? 1,
      message: row.message ?? reason,
      hint: hintFor(row, contextOf(row)),
    }));
    const bounded = cut(drawn, maxNodes);
    groups.push({
      reason,
      level,
      count: list.length,
      sites: list.reduce((sum, row) => sum + (row.sites ?? 1), 0),
      known,
      excluded: ignore.has(reason),
      // Rows of one reason nearly always share their advice, so the group says
      // it once. Nearly: a row the joined graph knew something about has its
      // own, and the group takes whichever sentence the most rows agree on so
      // the exception is the line that stands out rather than the rule.
      hint: commonest(drawn.map((row) => row.hint)),
      rows: bounded.rows,
      ...(bounded.truncated === undefined ? {} : { truncated: bounded.truncated }),
    });
  }

  groups.sort(
    (a, b) =>
      (a.level === b.level ? 0 : a.level === 'action' ? -1 : 1) ||
      b.sites - a.sites ||
      cmp(a.reason, b.reason),
  );
  return { groups, unknown: unknown.sort(cmp) };
};

/** A call that was aimed somewhere and did not land, with everything about it. */
const desyncOf = (
  rows: readonly Unresolved[],
  contextOf: (row: Unresolved) => HintContext,
  maxNodes: number,
): { rows: DesyncRow[]; truncated?: number } => {
  const found: DesyncRow[] = [];
  for (const row of rows) {
    if (!DESYNC_REASONS.has(row.reason)) continue;
    const context = contextOf(row);
    const node = context.node;
    found.push({
      call: row.symbol ?? '',
      service: row.service ?? node?.repo ?? '',
      method: text(node?.meta?.['method']),
      path: text(node?.meta?.['path']),
      baseUrlEnv: text(node?.meta?.['baseUrlEnv']),
      targetService: text(node?.meta?.['targetService']),
      reason: row.reason,
      file: row.file,
      line: row.line,
      message: row.message ?? row.reason,
      hint: hintFor(row, context),
    });
  }
  found.sort(
    (a, b) => cmp(a.service, b.service) || cmp(a.file, b.file) || a.line - b.line || cmp(a.call, b.call),
  );
  return cut(found, maxNodes);
};

const onService = (row: Unresolved, service: string): boolean => (row.service ?? '') === service;

/**
 * Runs the check over an opened graph.
 *
 * Pure in the sense that matters: it opens nothing, writes nothing and spawns
 * nothing. The command around it decides where the graph came from and what to
 * do with the exit code; everything that decides the exit code is here, so a
 * test can ask for a verdict without a file system.
 */
export const runDoctor = (input: DoctorInput, settings: DoctorSettings = {}): DoctorReport => {
  const sections = [...(settings.sections ?? SECTIONS)];
  const wanted = new Set<Section>(sections);
  const maxNodes = settings.maxNodes ?? 150;
  /**
   * How many places of one reason to name before saying how many more.
   *
   * The other sections are tables with a row each; this one is a list of
   * locations, and one reason can hold hundreds of them. A real project
   * answered `doctor` with 691 rows of `db-receiver-name-only`, all saying the
   * same sentence, and the command the README calls "the one to run after a
   * first build" was six hundred lines nobody reads. What a reader needs from a
   * reason is the advice, how many places it covers, and enough of them to
   * recognise the shape; `--max-nodes` is there for the rest, and the written
   * file always has all of it.
   */
  const perReason = settings.maxNodes ?? 6;
  const strict = settings.strict === true;
  const ignore = new Set(settings.ignoreReasons ?? []);
  const { db } = input;

  const rows =
    settings.service === undefined
      ? input.unresolved
      : input.unresolved.filter((row) => onService(row, settings.service as string));

  const skipped = (): { status: SectionStatus } => ({ status: 'skipped' });

  // ---- unresolved -------------------------------------------------------
  //
  // A row names its symbol however the pass that wrote it names things: an id
  // for anything the linker raised, the source text for anything raised while
  // one repository was being read. The second kind still points at a place, so
  // the call at that place is what the hint is about.
  const callsAt = new Map<string, GraphNode>();
  for (const call of db.nodesByType('http_out')) {
    callsAt.set(`${call.repo}|${call.file ?? ''}|${call.line ?? 0}`, call);
  }
  const nodeFor = (row: Unresolved): GraphNode | undefined => {
    if (row.symbol !== undefined) {
      const byId = db.node(row.symbol);
      if (byId !== undefined) return byId;
    }
    return callsAt.get(`${row.service ?? ''}|${row.file}|${row.line}`);
  };
  const contextOf = (row: Unresolved): HintContext => {
    const node = nodeFor(row);
    if (node === undefined) return {};
    return {
      node,
      joined: node.type === 'http_out' && db.edgesFrom(node.id, ['http_calls']).length > 0,
    };
  };
  const snapshot: UnresolvedSnapshot = snapshotOf(rows, { ignoreReasons: [...ignore] });
  const grouped = wanted.has('unresolved')
    ? groupByReason(rows, contextOf, ignore, perReason)
    : { groups: [], unknown: [] };
  const excludedSites = rows
    .filter((row) => (row.level ?? 'action') === 'action' && ignore.has(row.reason))
    .reduce((sum, row) => sum + (row.sites ?? 1), 0);

  const unresolved: DoctorReport['unresolved'] = {
    status: wanted.has('unresolved') ? 'ok' : 'skipped',
    total: snapshot.total,
    rows: rows.length,
    sites: rows.reduce((sum, row) => sum + (row.sites ?? 1), 0),
    info: snapshot.info,
    excluded: { reasons: [...ignore].sort(cmp), sites: excludedSites },
    byReason: grouped.groups,
    unknownReasons: grouped.unknown,
  };

  // ---- contracts --------------------------------------------------------
  let contracts: DoctorReport['contracts'] = {
    ...skipped(),
    note: null,
    errors: [],
    errorCount: 0,
    ignored: 0,
    unchecked: 0,
  };
  let parties: string[] | undefined;
  if (wanted.has('contracts') && settings.contracts !== false) {
    try {
      const report = checkContracts(db, settings.check ?? {});
      const summary = summarizeForDoctor(report);
      parties = summary.parties;
      const errors =
        settings.service === undefined
          ? summary.errors
          : summary.errors.filter(
              (finding) =>
                finding.sender.service === settings.service ||
                finding.receiver.service === settings.service,
            );
      const bounded = cut(errors, maxNodes);
      contracts = {
        status: 'ok',
        note: null,
        errors: bounded.rows,
        errorCount: errors.length,
        ignored: summary.ignored,
        unchecked: summary.unchecked,
        ...(bounded.truncated === undefined ? {} : { truncated: bounded.truncated }),
      };
    } catch (cause) {
      // A check that cannot run is not a project that is broken, so it says so
      // and does not fail the build (§10). Silence would be the alternative.
      contracts = {
        status: 'unavailable',
        note: `contracts could not be checked: ${cause instanceof Error ? cause.message : String(cause)}`,
        errors: [],
        errorCount: 0,
        ignored: 0,
        unchecked: 0,
      };
    }
  }

  // ---- markers ----------------------------------------------------------
  let markers: DoctorReport['markers'] = {
    ...skipped(),
    note: null,
    errors: 0,
    warnings: 0,
    issues: [],
  };
  if (wanted.has('markers')) {
    const found: MarkerIssue[] = validateMarkers(db, {
      unresolved: input.unresolved,
      ...(parties === undefined ? {} : { parties }),
      ...(settings.envOwners === undefined ? {} : { envOwners: settings.envOwners }),
    }).filter((issue) => settings.service === undefined || issue.service === settings.service);
    const bounded = cut(found, maxNodes);
    const annotated = db.allNodes().some((node) => Array.isArray(node.meta?.['markers']));
    markers = {
      status: 'ok',
      note: annotated
        ? parties === undefined && found.every((issue) => issue.code !== 'marker-contractignore-unused')
          ? '@ContractIgnore was not checked: contracts did not run'
          : null
        : 'no annotation is recorded on any symbol in this graph, so nothing was checked',
      errors: found.filter((issue) => issue.severity === 'error').length,
      warnings: found.filter((issue) => issue.severity === 'warning').length,
      issues: bounded.rows,
      ...(bounded.truncated === undefined ? {} : { truncated: bounded.truncated }),
    };
  }

  // ---- desync -----------------------------------------------------------
  const desync: DoctorReport['desync'] = wanted.has('desync')
    ? { status: 'ok', ...desyncOf(rows, contextOf, maxNodes) }
    : { ...skipped(), rows: [] };

  // ---- baseline ---------------------------------------------------------
  const baseline = wanted.has('baseline')
    ? compareBaseline(snapshot, settings.baseline, { schemaVersion: db.schemaVersion() })
    : compareBaseline(snapshot, undefined);

  // ---- verdict ----------------------------------------------------------
  const reasons: string[] = [];
  const markerErrors =
    markers.errors + (settings.warnAsError === true ? markers.warnings : 0);
  if (markerErrors > 0) {
    reasons.push(
      `${markerErrors} annotation${markerErrors === 1 ? '' : 's'} the graph contradicts`,
    );
  }
  if (contracts.errorCount > 0) {
    reasons.push(
      `${contracts.errorCount} contract error${contracts.errorCount === 1 ? '' : 's'} nothing excused`,
    );
  }
  if (baseline.status === 'grew') {
    reasons.push(
      `unresolved grew by ${baseline.total.delta} (${baseline.total.baseline} accepted, ${baseline.total.current} now)`,
    );
  }
  const failing = strict && reasons.length > 0;
  if (baseline.status === 'invalid') {
    reasons.push(baseline.note ?? 'the baseline could not be read');
  }

  const exitCode: 0 | 1 | 2 =
    baseline.status === 'invalid' ? 2 : failing ? 1 : 0;

  return {
    doctorFormatVersion: DOCTOR_FORMAT_VERSION,
    schemaVersion: db.schemaVersion(),
    flowatlasVersion: settings.flowatlasVersion ?? '0.0.0',
    generatedAt: settings.generatedAt ?? new Date().toISOString(),
    strict,
    baselinePath: settings.baselinePath ?? null,
    sections,
    note: input.note ?? null,
    unresolved,
    markers,
    desync,
    contracts,
    baseline,
    verdict: { exitCode, reasons },
  };
};
