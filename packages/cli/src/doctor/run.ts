/**
 * The health check itself: five questions asked of one built graph.
 *
 * Nothing here reads a repository. Everything it says comes from the graph, the
 * report the build wrote beside it and the baseline, which is what makes it
 * cheap enough to run on every push and what makes its answer reproducible: two
 * runs over one graph say the same thing, so a difference in CI is a difference
 * in the project.
 */
import { tally, wasMissed, type GraphNode, type Unresolved } from '@flowatlas/core';
import { checkContracts, type CheckOptions } from '@flowatlas/contracts';
import { summarizeForDoctor } from '@flowatlas/contracts';
import type { GraphDb, ServiceReport } from '@flowatlas/linker';
import { halfOf } from '../readers.js';
import {
  compareBaseline,
  isProblem,
  snapshotOf,
  type BaselineRead,
  type UnresolvedSnapshot,
} from './baseline.js';
import {
  ANSWERED_HINT,
  answeredByMarker,
  requestsAround,
  genericHint,
  hintFor,
  isKnownReason,
  kindHint,
  type HintContext,
} from './hints.js';
import { validateMarkers, type MarkerIssue } from './markers.js';
import { mostlyUnread, noWayInSentence, waysInByService, waysInTotal, type WaysIn } from './ways-in.js';
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
  /**
   * What a service's repository looks like, for one that has no way in (R170).
   * Handed in because this module reads no repository; without it, the
   * service's configured type is all that is said.
   */
  looksLike?: (service: { name: string; type: string }) => string | undefined;
  /**
   * The services the configuration declares by a document rather than points
   * at a repository of, by name: nothing of theirs was read, so whether they
   * have a way in is not a question about them (R173).
   */
  declared?: readonly string[];
}

/** The reasons that mean a call does not land where it was aimed. */
const DESYNC_REASONS: ReadonlySet<string> = new Set([
  'unknown-base-url-env',
  'target-route-not-found',
  'ambiguous-route',
  'ambiguous-route-application',
  'ambiguous-route-target',
  'route-wildcard-only',
]);

/**
 * What the graph and the report beside it say about themselves.
 *
 * Read once and handed to the checks below, so that each of them is a sentence
 * about facts rather than a second way of asking the database.
 */
interface GraphFacts {
  nodes: number;
  services: readonly ServiceReport[];
  /** Ways in found and read, per service. */
  ways: ReadonlyMap<string, WaysIn>;
}

/**
 * Whether this graph can be given a clean bill of health at all.
 *
 * Four ways it cannot, and they are one failure wearing four hats: the graph
 * came from a build that failed, or it holds nothing, or a service that was read
 * put nothing in it, or a service's ways in were read as far as their addresses
 * and, for most of them, no further. In every one of them the check that
 * follows is asked about a project the tool did not read, and every question it
 * asks answers "nothing wrong here" — which is true of the graph and false of
 * the project. `doctor` exited 0 on all four (R85, R94, R106).
 *
 * A lookup rather than a run of conditions, because each of these is an
 * independent claim about one graph and a fourth should be an entry here.
 */
const GRAPH_FAULTS: ReadonlyArray<(facts: GraphFacts) => string[]> = Object.freeze([
  (facts) =>
    facts.services
      .filter((service) => service.skipped === 'extract-failed')
      .map(
        (service) =>
          `the build that wrote this graph failed: ${service.name} could not be read` +
          `${service.error === undefined ? '' : ` (${service.error})`}, so this graph is the project without it`,
      ),
  (facts) =>
    facts.nodes === 0
      ? ['this graph holds no node at all, so nothing in it could be checked']
      : [],
  (facts) =>
    facts.services
      .filter(
        (service) =>
          service.skipped === undefined && service.extractor !== null && service.nodes === 0,
      )
      .map(
        (service) =>
          `${service.name} was read by ${service.extractor} and contributed no node, so nothing` +
          ' asked about that service can be answered from this graph',
      ),
  /**
   * A service whose ways in mostly have no body that was read (R94).
   *
   * Why this is the third hat and not an ordinary row. Each `route-handler-unread`
   * row is a real, reportable limit, and a service with a few of them — handlers
   * a helper builds that the reader cannot follow — is a service this graph
   * describes with gaps it names: those rows stay rows, a baseline may accept
   * them, and the run stays green. What changes past the point where most of a
   * service's ways in are hollow is what the checks can see, not how much is
   * missing. The growth check is the gate a team relies on, and it can only see
   * a change that produces a row; a change inside a body nobody read produces
   * none, ever. So for such a service the gate is not strict or lax, it is blind,
   * and accepting a baseline over it accepts the blindness — which is R85's and
   * R106's case exactly: a check that could not be run, answered as if it had
   * been. Hence exit 2, without waiting for `--strict`, and `--accept` refusing.
   *
   * The count is the one `build` prints, from `ways-in.ts`, so the summary line
   * a reader saw and the verdict they got cannot disagree about a number.
   */
  (facts) =>
    [...facts.ways]
      .filter(([, ways]) => mostlyUnread(ways))
      .map(
        ([name, ways]) =>
          `${name}: ${ways.found - ways.read} of its ${ways.found} ways in have no handler that was read,` +
          ' so what happens after a request arrives there is not in this graph, and a change inside one' +
          ' of those bodies can never add a row for a baseline to catch — the route-handler-unread rows' +
          ' above name each one',
      ),
]);

/**
 * The sentences, if any, that say this graph is not one to report on.
 *
 * Narrowed to one service when the run was, because a fault about a service
 * nobody asked about is not an answer to the question that was asked. The
 * graph-wide fault — no nodes anywhere — is never narrowed away, since there is
 * no service for which it is untrue.
 */
const graphFaults = (
  db: GraphDb,
  ways: ReadonlyMap<string, WaysIn>,
  service?: string,
): string[] => {
  const report = db.report();
  const services = report?.services ?? [];
  const facts: GraphFacts = {
    nodes: report?.totals.nodes ?? db.allNodes().length,
    services: service === undefined ? services : services.filter((one) => one.name === service),
    ways,
  };
  return GRAPH_FAULTS.flatMap((check) => check(facts));
};

/**
 * The kinds of node a flow can start at: a way in on the server, a subscriber,
 * and the screens and taps of a browser half the server reader read alongside.
 */
const WAY_IN_TYPES = ['entry', 'consumer', 'ui_component', 'ui_action'] as const;

/**
 * Services a server reader read into the graph that have no way in at all (R170).
 *
 * The code was read — the service holds nodes — and nothing in this graph
 * reaches it, so no flow starts there and every question that begins at a way
 * in passes it by. On the first contact with a stack nothing reads, this was
 * described as a partial read with its dependencies missing, and installing them
 * changes nothing; what the repository looks like is the finding, so each is
 * described by `looksLike`, which reads the repository and is handed in because
 * this module reads none.
 *
 * Not a fault, and it decides no exit code. The bodies were read, so a change
 * inside one still adds a row for the growth check to see — the gate is not
 * blind, as it is for a service whose ways in are mostly unread — and a library
 * typed as a server is a configuration somebody may mean.
 *
 * It says nothing about a service declared by a document, by rule rather than
 * because a declared service happens to have no server type: no code of it was
 * read, and a document that declares no way in describes a service nothing here
 * enters, not a stack nothing reads (R173).
 */
const withoutWaysInOf = (
  db: GraphDb,
  settings: DoctorSettings,
): Pick<DoctorReport['unresolved'], 'withoutWaysIn'> => {
  const entered = new Set(WAY_IN_TYPES.flatMap((type) => db.nodesByType(type)).map((node) => node.repo));
  const declared = new Set(settings.declared ?? []);
  const found = (db.report()?.services ?? [])
    .filter((service) => settings.service === undefined || service.name === settings.service)
    .filter((service) => !declared.has(service.name))
    .filter(
      (service) =>
        service.skipped === undefined &&
        service.extractor !== null &&
        service.nodes > 0 &&
        halfOf(service.type) === 'server' &&
        !entered.has(service.name),
    )
    .map((service) => ({
      service: service.name,
      looksLike: settings.looksLike?.(service) ?? `it is configured as ${service.type}`,
    }));
  return found.length === 0 ? {} : { withoutWaysIn: found };
};

/** What the verdict is decided from, read once from the sections above. */
interface VerdictFacts {
  strict: boolean;
  markerErrors: number;
  contractErrors: number;
  baseline: DoctorReport['baseline'];
  withoutWaysIn: NonNullable<DoctorReport['unresolved']['withoutWaysIn']>;
  /** The sentences that say this graph is not one to report on. */
  faults: readonly string[];
}

const plural = (count: number, one: string, many = `${one}s`): string =>
  `${count} ${count === 1 ? one : many}`;

/**
 * What the verdict says, in the order it says it: one rule per kind of
 * sentence, each saying nothing when it does not apply.
 *
 * A service with no way in is said first (R170), because a reader of that
 * service has to hear it before anything else in the report makes sense, and
 * before anything about dependencies: installing them would not give it one.
 */
const VERDICT_REASONS: ReadonlyArray<{ says(facts: VerdictFacts): string[] }> = Object.freeze([
  { says: (facts) => facts.withoutWaysIn.map(noWayInSentence) },
  {
    says: (facts) =>
      facts.markerErrors > 0 ? [`${plural(facts.markerErrors, 'annotation')} the graph contradicts`] : [],
  },
  {
    says: (facts) =>
      facts.contractErrors > 0 ? [`${plural(facts.contractErrors, 'contract error')} nothing excused`] : [],
  },
  {
    says: ({ baseline }) =>
      baseline.status === 'grew'
        ? [`unresolved grew by ${baseline.total.delta} (${baseline.total.baseline} accepted, ${baseline.total.current} now)`]
        : [],
  },
  {
    says: ({ baseline }) =>
      baseline.status === 'invalid' ? [baseline.note ?? 'the baseline could not be read'] : [],
  },
  { says: (facts) => [...facts.faults] },
  {
    says: ({ strict, baseline }) =>
      strict && baseline.status === 'missing'
        ? [`${baseline.note ?? 'there is no baseline'} — or pass --no-baseline to check annotations and contracts only`]
        : [],
  },
]);

/** Whether a strict run found something: a check ran and its answer was no. */
const foundSomething = (facts: VerdictFacts): boolean =>
  facts.markerErrors > 0 || facts.contractErrors > 0 || facts.baseline.status === 'grew';

/**
 * The exit code, as an ordered list of rules: the first that applies decides it.
 *
 * 2 means a check could not be run, and comes first, because a finding from a
 * check that could not be run is not one. A graph nobody could report on is the
 * first of those, and it does not wait for `--strict`: a run without the flag
 * still answers a question, and "nothing wrong" is not an answer anybody asked
 * of an unread graph — so the one gate a team can disable by dropping a flag is
 * not the only thing standing between it and a clean bill of health, and
 * `--accept` refuses it for the same reason. Calling it 1 would say the project
 * is broken when the reading is; calling it 0 is what every one of these bugs
 * did (R85, R94, R106). A baseline that cannot be read is the second, and a
 * strict run with no baseline the third: a gate with nothing to compare against
 * is not a gate. Only then does 1 mean what it says — a strict run whose checks
 * ran and found something.
 */
const EXIT_RULES: ReadonlyArray<{ applies(facts: VerdictFacts): boolean; exitCode: 0 | 1 | 2 }> =
  Object.freeze([
    { applies: (facts) => facts.faults.length > 0, exitCode: 2 },
    { applies: (facts) => facts.baseline.status === 'invalid', exitCode: 2 },
    { applies: (facts) => facts.strict && facts.baseline.status === 'missing', exitCode: 2 },
    { applies: (facts) => facts.strict && foundSomething(facts), exitCode: 1 },
  ]);

const NOTHING_FAILS = { exitCode: 0 } as const;

/** Ways in per service, narrowed as the run is. */
const waysOf = (db: GraphDb, service?: string): Map<string, WaysIn> => {
  const all = waysInByService(
    db.nodesByType('entry'),
    (id) => db.edgesFrom(id, ['handles']).length > 0,
  );
  return service === undefined
    ? all
    : new Map([...all].filter(([name]) => name === service));
};

const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The one sentence they all say, or nothing when they do not all say one. */
const unanimous = (values: readonly string[]): string | undefined => {
  const first = values[0];
  if (first === undefined) return undefined;
  return values.every((value) => value === first) ? first : undefined;
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
  // Keyed by reason *and* level, so a group's level is every member's and not
  // its loudest member's. One reason can hold both: a call whose address is
  // built at run time is something to do, and the same reason on a call an
  // annotation already answers is not (R36). Grouped together, the second
  // would be listed under a heading asking for work that is already done.
  const SPLIT = '\u0000';
  const levelOf = (row: Unresolved): 'action' | 'info' | 'nothing' =>
    (row.level ?? 'action') as 'action' | 'info' | 'nothing';
  const byReason = new Map<string, Unresolved[]>();
  for (const row of rows) {
    const key = `${row.reason}${SPLIT}${levelOf(row)}`;
    const list = byReason.get(key);
    if (list === undefined) byReason.set(key, [row]);
    else list.push(row);
  }

  const unknown: string[] = [];
  const groups: ReasonGroup[] = [];
  const seen = new Set<string>();
  for (const [key, list] of byReason) {
    const reason = key.slice(0, key.indexOf(SPLIT));
    const level = levelOf(list[0] as Unresolved);
    const known = isKnownReason(reason);
    if (!known && !seen.has(reason)) unknown.push(reason);
    seen.add(reason);
    const drawn: DoctorRow[] = list.map((row) => ({
      service: row.service ?? '',
      file: row.file,
      line: row.line,
      symbol: row.symbol ?? null,
      level: (row.level ?? 'action') as 'action' | 'info' | 'nothing',
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
      // A sentence true of every member, which is the only kind a heading may
      // carry. The members' own, when they all say one thing — unanimity is
      // that guarantee — and otherwise the kind's, written once in the
      // catalogue with nothing of any one member in it. What it may never be is
      // whichever sentence the most members agreed on, which is what it was:
      // that asserted one member's symbol over all of them, and left the
      // sentence it belonged to floating below somebody else's site (R35).
      hint: unanimous(drawn.map((row) => row.hint)) ?? kindHint(reason) ?? genericHint(reason),
      rows: bounded.rows,
      ...(bounded.truncated === undefined ? {} : { truncated: bounded.truncated }),
    });
  }

  const loudness = { action: 0, info: 1, nothing: 2 } as const;
  groups.sort(
    (a, b) => loudness[a.level] - loudness[b.level] || b.sites - a.sites || cmp(a.reason, b.reason),
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
 * The rows again, with the ones an annotation has already answered demoted.
 *
 * A row saying "annotate this" that the joined graph can see is annotated is
 * not something to act on: acting on it means writing an annotation that is
 * already there. It was counted in the number at the top of the section, which
 * is the whole argument for reading the section, and it was a row the baseline
 * could never be cleared of, because nothing anybody writes can clear it (R36).
 *
 * Applied once, at the top, so the count, the grouping, the fold and the
 * baseline are all looking at the same rows. Idempotent: a row already at
 * `info` is left as it is.
 */
export const withAnsweredDemoted = (
  rows: readonly Unresolved[],
  db: Pick<GraphDb, 'node' | 'nodesByType' | 'allNodes' | 'edgesFrom' | 'edgesTo'>,
): Unresolved[] => {
  // Both kinds of outgoing request: one row's node is the call it names, and a
  // browser request was never indexed here at all, so no `api-path-dynamic`
  // row could find its node to be answered (R39).
  const callsAt = new Map<string, GraphNode>();
  for (const type of ['http_out', 'ui_api_call'] as const) {
    for (const call of db.nodesByType(type)) {
      callsAt.set(`${call.repo}|${call.file ?? ''}|${call.line ?? 0}`, call);
    }
  }
  /**
   * Methods by the name a row calls them, within the file they are declared in.
   *
   * A row names its symbol as it is written rather than by id, and for a
   * channel that is `OrdersService.publish -> channel`: the method, then what
   * about it could not be read. The line is the line of the *call*, not of the
   * method, so the join is the name and the file — the same join `doctor`
   * already makes to put a marker issue on a row.
   */
  const methodsAt = new Map<string, GraphNode>();
  for (const node of db.allNodes()) {
    if (node.type !== 'method') continue;
    methodsAt.set(`${node.repo}|${node.file ?? ''}|${node.label}`, node);
  }
  const idFor = (row: Unresolved): string | undefined => {
    if (row.symbol !== undefined && db.node(row.symbol) !== undefined) return row.symbol;
    const here = callsAt.get(`${row.service ?? ''}|${row.file}|${row.line}`);
    if (here !== undefined) return here.id;
    if (row.symbol === undefined) return undefined;
    const named = row.symbol.split(' -> ')[0] ?? row.symbol;
    return methodsAt.get(`${row.service ?? ''}|${row.file}|${named}`)?.id;
  };
  return rows.map((row) =>
    (row.level ?? 'action') === 'action' && answeredByMarker(row.reason, idFor(row), db)
      ? { ...row, level: 'info' as const, hint: ANSWERED_HINT }
      : row,
  );
};

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
  for (const type of ['http_out', 'ui_api_call'] as const) {
    for (const call of db.nodesByType(type)) {
      callsAt.set(`${call.repo}|${call.file ?? ''}|${call.line ?? 0}`, call);
    }
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
      // How the other requests in the same method stand, which is what decides
      // whether an annotation on it can only be about this one (R39).
      ...(node.type === 'ui_api_call'
        ? { requests: requestsAround(node.id, db) ?? undefined }
        : {}),
    };
  };

  const levelled = withAnsweredDemoted(rows, db);
  const ways = waysOf(db, settings.service);

  const snapshot: UnresolvedSnapshot = snapshotOf(levelled, { ignoreReasons: [...ignore] });
  const grouped = wanted.has('unresolved')
    ? groupByReason(levelled, contextOf, ignore, perReason)
    : { groups: [], unknown: [] };
  const excludedSites = levelled
    .filter((row) => (row.level ?? 'action') === 'action' && ignore.has(row.reason))
    .reduce((sum, row) => sum + (row.sites ?? 1), 0);

  // Places where nothing joins are their own line and nobody else's total.
  const missed = tally(levelled.filter(wasMissed));
  const unresolved: DoctorReport['unresolved'] = {
    status: wanted.has('unresolved') ? 'ok' : 'skipped',
    total: snapshot.total,
    rows: missed.rows,
    sites: missed.sites,
    info: snapshot.info,
    nothing: snapshot.nothing,
    excluded: { reasons: [...ignore].sort(cmp), sites: excludedSites },
    byReason: grouped.groups,
    unknownReasons: grouped.unknown,
    waysIn: waysInTotal(ways),
    ...withoutWaysInOf(db, settings),
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
  const facts: VerdictFacts = {
    strict,
    markerErrors: markers.errors + (settings.warnAsError === true ? markers.warnings : 0),
    contractErrors: contracts.errorCount,
    baseline,
    withoutWaysIn: unresolved.withoutWaysIn ?? [],
    faults: graphFaults(db, ways, settings.service),
  };
  const reasons = VERDICT_REASONS.flatMap((rule) => rule.says(facts));
  const exitCode = (EXIT_RULES.find((rule) => rule.applies(facts)) ?? NOTHING_FAILS).exitCode;

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
