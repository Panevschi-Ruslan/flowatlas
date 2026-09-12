/**
 * The check itself: every boundary in the project, compared.
 *
 * Inside one repository a type is a fact the compiler already checked. Between
 * two repositories it is a claim nobody checks, and this is the only thing in
 * the project that does. What comes out is meant to be read by a person and
 * consumed by three later commands, so it is deterministic to the byte and
 * nothing it could not check is left out of it.
 */
import { parseTypeRef, type ProjectGraph, type TypeEntry, type TypeRefAst } from '@flowatlas/core';
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

  const compare = (status: ContractStatus): Verdict => ({
    status,
    ...diffRefs(parse(sentRef), parse(wantRef), (id) => lookup.type(id), {
      depth: options.depth ?? DEFAULT_DEPTH,
      ...(options.disableRules === undefined ? {} : { disableRules: options.disableRules }),
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

const findingOf = (
  exchange: Exchange,
  diff: FieldDiff,
  ignoredBy: string | null,
): ContractFinding => ({
  severity: severityOf(diff.kind, diff.rule),
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
  message: describeDiff(diff, {
    sender: exchange.sender.service,
    receiver: exchange.receiver.service,
  }),
  ignored: ignoredBy !== null,
  ignoredBy,
});

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
    const found = verdict.diffs.map((diff) => findingOf(exchange, diff, ignoredBy));
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
