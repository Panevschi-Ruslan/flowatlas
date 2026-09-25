/**
 * The check itself: every boundary in the project, compared.
 *
 * Inside one repository a type is a fact the compiler already checked. Between
 * two repositories it is a claim nobody checks, and this is the only thing in
 * the project that does. What comes out is meant to be read by a person and
 * consumed by three later commands, so it is deterministic to the byte and
 * nothing it could not check is left out of it.
 */
import {
  DATA_REACH,
  makeTypeId,
  parseTypeRef,
  type ProjectGraph,
  type TypeEntry,
  type TypeRefAst,
} from '@flowatlas/core';
import { boundaries, namesAShape, type Exchange } from './boundary.js';
import { diffRefs } from './compare.js';
import { findingKey } from './key.js';
import { asLookup } from './lookup.js';
import { describeDiff } from './message.js';
import { severityOf } from './severity.js';
import { uncheckedNote } from './unchecked.js';
import {
  CONTRACTS_FORMAT_VERSION,
  DEFAULT_DEPTH,
  type CheckOptions,
  type ContractEdgeResult,
  type ContractFinding,
  type ContractReport,
  type ContractStatus,
  type ContractSummary,
  type FieldDiff,
  type GraphLookup,
  type StripImpact,
  type UncheckedEdge,
  type UncheckedReason,
} from './types.js';

/** The annotation that says a difference here is deliberate. */
const IGNORE_MARKER = 'ContractIgnore';

/** A reference the grammar cannot read, kept whole rather than thrown away. */
const parse = (ref: string): TypeRefAst => {
  try {
    return parseTypeRef(ref);
  } catch {
    return { kind: 'primitive', name: ref };
  }
};

/** The single registry id a reference is, when it is exactly one. */
const idOf = (ref: string): string | undefined => {
  const ast = parse(ref);
  return ast.kind === 'id' && ast.args === undefined ? ast.id : undefined;
};

/**
 * Types that describe how a body travels rather than what is in it.
 *
 * A request whose body was already turned into text, or handed to the transport
 * as a form or a stream, records that as its type. Comparing it against the
 * shape the handler declares would report every one of them as a mismatch,
 * when what actually happened is that the shape was lost a line earlier.
 */
const TRANSPORT_BODIES = new Set([
  'string',
  'FormData',
  'RequestInit',
  'Blob',
  'ArrayBuffer',
  'URLSearchParams',
  'ReadableStream',
]);

const isTransportBody = (ref: string): boolean => {
  const ast = parse(ref);
  if (ast.kind === 'primitive') return TRANSPORT_BODIES.has(ast.name);
  return ast.kind === 'generic' && TRANSPORT_BODIES.has(ast.name);
};

/** Markers the extractor recorded on a symbol, plus any the caller can supply. */
const markersOf = (
  lookup: GraphLookup,
  symbol: string,
  extra: CheckOptions['markersOf'],
): string[] => {
  const recorded = lookup.node(symbol)?.meta?.['markers'];
  const names = Array.isArray(recorded)
    ? recorded
        .map((marker) => (typeof marker === 'object' && marker !== null ? (marker as { name?: unknown }).name : marker))
        .filter((name): name is string => typeof name === 'string')
    : [];
  return names.length > 0 || extra === undefined ? names : [...extra(symbol)];
};

/** Copies from a shared package that two repositories did not read alike. */
interface Skew {
  repo: string;
  structuralHash: string;
}

const skewOf = (entry: TypeEntry | undefined): Skew[] => {
  const versions = entry?.meta?.['versions'];
  return Array.isArray(versions) ? (versions as Skew[]) : [];
};

interface Verdict {
  status: ContractStatus;
  diffs: FieldDiff[];
  rulesApplied: string[];
  blocked?: { reason: UncheckedReason; subject: string; detail?: string };
}

/**
 * Whether a route runs a validation pipe that strips undecorated properties.
 *
 * Read from what the build recorded about the route's wrapping: a pipe named
 * `ValidationPipe` configured with `whitelist: true`, wherever it was attached.
 * A pipe whose options could not be read says nothing, and nothing is assumed.
 */
const stripsUndecorated = (lookup: GraphLookup, entryId: string): boolean =>
  lookup.edgesFrom(entryId, ['guarded_by']).some((edge) => {
    if (edge.meta?.['layer'] !== 'pipe') return false;
    const pipe = lookup.node(edge.to);
    if (pipe === undefined || !pipe.label.startsWith('ValidationPipe')) return false;
    const [options] = Array.isArray(pipe.meta?.['factoryArgs']) ? (pipe.meta['factoryArgs'] as unknown[]) : [];
    return typeof options === 'object' && options !== null && (options as { whitelist?: unknown }).whitelist === true;
  });

/**
 * How well the two ends of one exchange agree.
 *
 * The order is the plan's: whether the two are the same declaration at all,
 * then whether they have the same shape, and only then field by field. Each
 * step that answers stops the ones after it, which is what keeps a project with
 * a proper shared package cheap to check.
 */
const judge = (lookup: GraphLookup, exchange: Exchange, options: CheckOptions): Verdict => {
  const nothing = { diffs: [], rulesApplied: [] };
  const sentRef = exchange.sender.typeId ?? undefined;
  const wantRef = exchange.receiver.typeId ?? undefined;

  if (exchange.blocked !== undefined) {
    return { status: 'unchecked', ...nothing, blocked: exchange.blocked };
  }
  if (!namesAShape(sentRef)) {
    return {
      status: 'unchecked',
      ...nothing,
      blocked: { reason: 'no-type-on-sender', subject: exchange.sender.symbol },
    };
  }
  if (!namesAShape(wantRef)) {
    return {
      status: 'unchecked',
      ...nothing,
      blocked: { reason: 'no-type-on-receiver', subject: exchange.receiver.symbol },
    };
  }
  if (exchange.direction === 'request' && sentRef !== wantRef && isTransportBody(sentRef)) {
    return {
      status: 'unchecked',
      ...nothing,
      blocked: { reason: 'body-already-serialised', subject: exchange.sender.symbol, detail: sentRef },
    };
  }

  const sentId = idOf(sentRef);
  const wantId = idOf(wantRef);
  const sentEntry = sentId === undefined ? undefined : lookup.type(sentId);
  const wantEntry = wantId === undefined ? undefined : lookup.type(wantId);

  for (const [id, entry] of [
    [sentId, sentEntry],
    [wantId, wantEntry],
  ] as const) {
    if (id === undefined) continue;
    if (entry === undefined) {
      return {
        status: 'unchecked',
        ...nothing,
        blocked: { reason: 'type-missing', subject: exchange.edgeKey, detail: id },
      };
    }
    if (entry.kind === 'external' || entry.kind === 'unknown') {
      return {
        status: 'unchecked',
        ...nothing,
        blocked: { reason: 'type-kind-unsupported', subject: exchange.edgeKey, detail: id },
      };
    }
  }

  const whitelist = exchange.direction === 'request' && stripsUndecorated(lookup, exchange.edge.to);
  const compare = (status: ContractStatus): Verdict => ({
    status,
    ...diffRefs(parse(sentRef), parse(wantRef), (id) => lookup.type(id), {
      depth: options.depth ?? DEFAULT_DEPTH,
      ...(options.disableRules === undefined ? {} : { disableRules: options.disableRules }),
      ...(whitelist ? { whitelist } : {}),
    }),
  });

  if (sentId !== undefined && sentId === wantId) {
    // One declaration, imported by both. Drift is impossible — unless the two
    // repositories have different copies of the package it lives in, which the
    // merge records and nothing else reports.
    const versions = skewOf(sentEntry);
    if (versions.length < 2) {
      const shared = sentEntry?.meta?.['sharedPackage'];
      return { status: typeof shared === 'string' ? 'shared' : 'identical', ...nothing };
    }
    const seen = versions.map((version) => `${version.repo} ${version.structuralHash}`).join(', ');
    const diff: FieldDiff = {
      kind: 'type_mismatch',
      path: '',
      expected: sentEntry?.name ?? sentId,
      actual: sentEntry?.name ?? sentId,
      rule: null,
      note: `both ends import it, and the repositories do not hold the same copy of it (${seen})`,
      message: '',
    };
    return {
      status: 'hash_differs',
      diffs: [{ ...diff, message: describeDiff(diff) }],
      rulesApplied: [],
    };
  }

  if (
    sentEntry !== undefined &&
    wantEntry !== undefined &&
    sentEntry.structuralHash === wantEntry.structuralHash
  ) {
    // Two declarations with one shape. Still walked when either is annotated,
    // because the hash deliberately ignores what the annotations do (P02).
    return { ...compare('identical') };
  }
  if (sentRef === wantRef) return { status: 'identical', ...nothing };

  return compare('hash_differs');
};

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Sorted by where they were found, so two runs print the same document. */
const order = (a: ContractFinding, b: ContractFinding): number =>
  cmp(a.edgeKey, b.edgeKey) ||
  cmp(a.direction, b.direction) ||
  cmp(a.field, b.field) ||
  cmp(a.kind, b.kind) ||
  cmp(a.receiver.symbol, b.receiver.symbol);

const emptySummary = (): ContractSummary => ({
  edges: 0,
  shared: 0,
  identical: 0,
  hash_differs: 0,
  unchecked: 0,
  errors: 0,
  warnings: 0,
  infos: 0,
  ignored: 0,
});

/** Which annotation or setting excuses this exchange, if any does. */
const excusedBy = (
  lookup: GraphLookup,
  exchange: Exchange,
  options: CheckOptions,
): string | null => {
  if (options.honourIgnore === false) return null;
  if ((options.ignoreEdges ?? []).includes(exchange.edgeKey)) return 'config:contracts.ignoreEdges';
  for (const symbol of exchange.symbols) {
    if (markersOf(lookup, symbol, options.markersOf).includes(IGNORE_MARKER)) return symbol;
  }
  return null;
};

/**
 * The method in a browser application that makes a request nothing reaches.
 *
 * A method nothing in its repository names — not a method, a constructor, an
 * initializer, a template or a function — is not code that runs, and a
 * disagreement found on it is one nobody meets. It is still worth a line, but
 * not a failed build. The graph's own call edges cannot answer this, since they
 * are only drawn from methods, so the extractor asks the compiler and marks the
 * method `unreferenced`; nothing unmarked is ever softened.
 */
const unreachedCaller = (lookup: GraphLookup, exchange: Exchange): string | null => {
  if (exchange.edge.type !== 'hits') return null;
  const [caller] = exchange.symbols;
  if (caller === undefined) return null;
  if (lookup.node(caller)?.meta?.['unreferenced'] !== true) return null;
  // A template names a method without the compiler seeing it; the graph does,
  // so anything reaching the method in the graph keeps the finding an error.
  return lookup.edgesTo(caller).length === 0 ? caller : null;
};

const findingOf = (
  exchange: Exchange,
  diff: FieldDiff,
  ignoredBy: string | null,
  unreached: string | null = null,
  impact?: StripImpact,
): ContractFinding => ({
  severity:
    unreached !== null && severityOf(diff.kind, diff.rule, impact) === 'error'
      ? 'warning'
      : severityOf(diff.kind, diff.rule, impact),
  kind: diff.kind,
  edge: exchange.edge,
  edgeKey: exchange.edgeKey,
  direction: exchange.direction,
  sender: exchange.sender,
  receiver: exchange.receiver,
  typeId: exchange.receiver.typeId ?? exchange.sender.typeId ?? '',
  field: diff.path,
  expected: diff.expected,
  actual: diff.actual,
  rule: diff.rule,
  ...(impact === undefined ? {} : { impact }),
  message:
    describeDiff(diff, {
      sender: exchange.sender.service,
      receiver: exchange.receiver.service,
      // A request is the one direction with an object written at a call site to
      // read from, so it is the one direction where reading a declared type
      // instead is a weaker claim and has to be said as one. A response and a
      // payload have only ever had the declared type, and their wording is not
      // what R34 is about.
      observed: exchange.direction !== 'request' || exchange.sender.writes !== undefined,
      everyCall: exchange.direction !== 'request' || exchange.sender.writesEvery !== false,
    }) + (unreached === null ? '' : `; nothing in the project calls ${unreached}`),
  ignored: ignoredBy !== null,
  ignoredBy,
});



/**
 * Every write a route's handler reaches, and the document each one names.
 *
 * Walked from the entry the same way the guard audit walks it, and stopping at
 * the same distance, so "reaches stored data" means one thing across the tool.
 * The db adapter has already worked out which calls are writes and which
 * entity each one is about; this only collects them.
 *
 * A write is recognised by the node being one, not by it having an edge to a
 * table. A write whose table could not be read has no `queries` edge and was
 * therefore invisible here — and a handler that writes would have been reported
 * as one that cannot lose anything, which is the kind of quiet false comfort
 * this check exists to remove.
 *
 * One walk, answering both questions the impact needs, because walking twice
 * per stripped field is the same traversal repeated for every row on the route.
 */
const writesReachedBy = (
  lookup: GraphLookup,
  entryId: string,
): { any: boolean; documents: TypeEntry[] } => {
  const repo = lookup.node(entryId)?.repo ?? '';
  const documents: TypeEntry[] = [];
  let any = false;
  const seen = new Set<string>([entryId]);
  let frontier = [entryId];
  for (let depth = 0; depth < DATA_REACH && frontier.length > 0; depth += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const edge of lookup.edgesFrom(id, ['handles', 'calls'])) {
        if (seen.has(edge.to)) continue;
        seen.add(edge.to);
        next.push(edge.to);
        const node = lookup.node(edge.to);
        if (node?.type !== 'db_query' || node.meta?.['op'] !== 'write') continue;
        any = true;
        // The id the write recorded, which is the reliable answer; the name is
        // the fallback for a graph written before that was kept.
        const byId = node.meta['entityTypeId'];
        const named = node.meta['entityType'];
        const entry =
          typeof byId === 'string' && byId !== ''
            ? lookup.type(byId)
            : typeof named === 'string' && named !== ''
              ? lookup.type(makeTypeId(repo, named))
              : undefined;
        if (entry !== undefined) documents.push(entry);
      }
    }
    frontier = next;
  }
  return { any, documents };
};

/**
 * What a field the receiver strips off the body actually costs.
 *
 * Seventy-nine rows on one project, every one of them true, one of them a bug
 * that had been in production unnoticed: a field the admin screen sets, the
 * kitchen display groups by, and the DTO does not declare. Finding it cost an
 * afternoon of reading the other seventy-eight, which is the afternoon the tool
 * exists to save (R30).
 *
 * Neither test is a name heuristic. `_id` and `createdAt` need no special case:
 * they fail the second test on their own, because the handler does not read
 * them off the body.
 */
const stripImpact = (
  writes: { any: boolean; documents: TypeEntry[] },
  field: string,
): StripImpact => {
  if (!writes.any) return 'none';
  // Only a key of the body itself. A nested path's last segment is not a
  // top-level field of the document: `options.name` matched against a document
  // with a `name` said the sender believed it had saved something, about a
  // different field entirely.
  if (field.includes('.') || field.includes('[')) return 'unknown';
  // Something is written and no shape of it was read, so there is nothing to
  // look the field up in. Answering `unknown` here said "nothing it writes
  // declares this field", which is a claim nobody was in a position to make
  // (R43).
  if (writes.documents.length === 0) return 'unread';
  const stored = writes.documents.some((entry) =>
    (entry.fields ?? []).some((each) => each.name === field),
  );
  return stored ? 'stored' : 'unknown';
};

/**
 * Whether a disagreement is about something the call actually puts on the wire.
 *
 * A boundary is compared on two declared types, and a declared type on the
 * sending side says what the call is *permitted* to send. Where an object
 * written in the source says which keys it writes, a key it does not write is
 * not sent, and a sentence about a key nothing sends is not a finding — it is
 * the tool reading a permission as an act (R34).
 *
 * Only for what the sender is being accused of putting there: `extra_field`,
 * and a field the receiver made optional that the sender is said to always
 * send. A field the receiver *requires* is left alone, because a literal that
 * does not write it is an argument for the finding rather than against it.
 *
 * Only at the top of the shape. Below that the keys are the declared type's,
 * and the literal says nothing about them.
 */
const isSent = (exchange: Exchange, diff: FieldDiff): boolean => {
  const writes = exchange.sender.writes;
  if (writes === undefined || exchange.direction !== 'request') return true;
  if (diff.path === '' || diff.path.includes('.') || diff.path.includes('[')) return true;
  const accuses =
    diff.kind === 'extra_field' ||
    (diff.kind === 'optionality_mismatch' && diff.optionalOn === 'receiver');
  return !accuses || writes.includes(diff.path);
};

/**
 * Every boundary in a project, checked.
 *
 * Takes the graph in whichever form the caller holds it, so `doctor`, `diff`
 * and `dead` all ask the same question of the same code rather than each
 * growing a version of it.
 */
export const checkContracts = (
  source: ProjectGraph | GraphLookup,
  options: CheckOptions = {},
): ContractReport => {
  const lookup = asLookup(source);
  const edges: ContractEdgeResult[] = [];
  const findings: ContractFinding[] = [];
  const ignored: ContractFinding[] = [];
  const unchecked: UncheckedEdge[] = [];
  const summary = emptySummary();

  /**
   * What each route writes, worked out once.
   *
   * Every stripped field on one route asks the same question of the same
   * handler, and the answer cannot change between two fields of one body.
   */
  const writes = new Map<string, { any: boolean; documents: TypeEntry[] }>();
  const writesOf = (entryId: string): { any: boolean; documents: TypeEntry[] } => {
    const known = writes.get(entryId);
    if (known !== undefined) return known;
    const found = writesReachedBy(lookup, entryId);
    writes.set(entryId, found);
    return found;
  };

  for (const exchange of boundaries(lookup)) {
    const verdict = judge(lookup, exchange, options);
    if (verdict.blocked !== undefined) {
      const { reason, subject, detail } = verdict.blocked;
      const note = uncheckedNote(reason, subject, exchange.direction, detail);
      unchecked.push({
        edge: exchange.edge,
        edgeKey: exchange.edgeKey,
        direction: exchange.direction,
        reason,
        message: note.message,
        hint: note.hint,
      });
      summary.unchecked += 1;
      continue;
    }

    const ignoredBy = excusedBy(lookup, exchange, options);
    const unreached = unreachedCaller(lookup, exchange);
    const found = verdict.diffs
      .filter((diff) => isSent(exchange, diff))
      .map((diff) =>
        findingOf(
          exchange,
          diff,
          ignoredBy,
          unreached,
          // Only a strip has anything to lose, and only the receiving end of a
          // request has a handler to ask about it.
          diff.rule === 'whitelist-strip' && exchange.direction === 'request'
            ? stripImpact(writesOf(exchange.edge.to), diff.path)
            : undefined,
        ),
      );
    edges.push({
      edge: exchange.edge,
      edgeKey: exchange.edgeKey,
      direction: exchange.direction,
      status: verdict.status,
      sender: exchange.sender,
      receiver: exchange.receiver,
      findings: found,
      rulesApplied: verdict.rulesApplied,
    });
    summary[verdict.status] += 1;
    for (const finding of found) {
      if (finding.ignored) {
        ignored.push(finding);
        summary.ignored += 1;
        continue;
      }
      findings.push(finding);
      if (finding.severity === 'error') summary.errors += 1;
      else if (finding.severity === 'warning') summary.warnings += 1;
      else summary.infos += 1;
    }
  }

  summary.edges = edges.length;
  return {
    contractsFormatVersion: CONTRACTS_FORMAT_VERSION,
    schemaVersion: options.schemaVersion ?? lookup.schemaVersion?.() ?? 0,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    edges,
    findings: findings.sort(order),
    ignored: ignored.sort(order),
    unchecked,
    summary,
  };
};

/** Findings that would fail a build: errors, never the excused ones. */
export const errorsOf = (report: ContractReport): ContractFinding[] =>
  report.findings.filter((finding) => finding.severity === 'error');

/** Findings at or above a severity, worst first. */
export const bySeverity = (
  report: ContractReport,
  least: ContractFinding['severity'],
): ContractFinding[] => {
  const rank = { error: 0, warning: 1, info: 2 };
  return report.findings.filter((finding) => rank[finding.severity] <= rank[least]);
};

export { findingKey };
