/**
 * What a contract check says, and in what words.
 *
 * Inside one repository a type is a fact the compiler has already checked. On
 * the boundary between two repositories it is only a claim: one side writes a
 * shape into JSON and the other declares what it expects to read back, and
 * nothing anywhere compares the two. These are the words for that comparison.
 */
import type { GraphEdge, GraphNode, TypeEntry } from '@flowatlas/core';

/**
 * Version of `contracts.json`, independent of the graph schema.
 *
 * 2 — a party carries `writes`, the keys an object written at the call site
 * puts on the wire, and a request-direction message says whether it is
 * describing what a call sends or what its declared type permits (R34).
 *
 * 3 — a strip's `impact` may read `unread`, which `unknown` used to stand in
 * for. A reader that branches on the three older words would take a field
 * nobody could look for as a field nobody found, so the widening is a version
 * of its own rather than a quiet addition (R43).
 */
export const CONTRACTS_FORMAT_VERSION = 3;

/** How bad a finding is. */
export const SEVERITIES = ['error', 'warning', 'info'] as const;

export type Severity = (typeof SEVERITIES)[number];

/**
 * What went wrong, in the four ways a shape can disagree with another.
 *
 * `missing_required` the receiver needs a field nothing sends · `type_mismatch`
 * both sides know the field and disagree about what is in it ·
 * `optionality_mismatch` one side may leave it out and the other may not ·
 * `extra_field` something is sent that nobody reads.
 */
export const FINDING_KINDS = [
  'missing_required',
  'type_mismatch',
  'optionality_mismatch',
  'extra_field',
] as const;

export type FindingKind = (typeof FINDING_KINDS)[number];

/**
 * Which half of an exchange is being checked.
 *
 * `request` what a caller sends to a handler, `response` what the handler
 * answers with, `payload` what a publisher puts on a channel. Each is checked
 * separately: fixing one says nothing about the other.
 */
export const DIRECTIONS = ['request', 'response', 'payload'] as const;

export type Direction = (typeof DIRECTIONS)[number];

/** Which end of the exchange a field is being read from. */
export type Side = 'sender' | 'receiver';

/**
 * How well two ends agree, before any field is looked at.
 *
 * `shared` neither end owns the declaration, so drift is impossible ·
 * `identical` two declarations that happen to have the same shape today ·
 * `hash_differs` they do not, and the fields say how · `unchecked` there was
 * nothing to compare. The four words are P06's, so `check_contract` and this
 * report answer alike.
 */
export const CONTRACT_STATUSES = ['shared', 'identical', 'hash_differs', 'unchecked'] as const;

export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

/**
 * What a field the receiver throws away can cost.
 *
 * A whitelisting pipe removes an undeclared field before the handler runs, and
 * seventy-nine of those on one project are not seventy-nine problems. Two
 * things the graph already knows tell them apart, and neither is the spelling
 * of the name (R30):
 *
 * `stored`  — the handler writes a document that declares this field, so the
 *             sender believes it saved something that never arrived.
 * `unread`  — it writes something, and no document of anything it writes could
 *             be read. A knex or drizzle call names a table and no shape, and
 *             fifteen of the twenty-three writes in this repository's own
 *             fixtures are that shape. Nothing here rules the loss in or out,
 *             which is a different sentence from the one below and used to be
 *             told in the same words (R43).
 * `unknown` — it writes something, documents of what it writes were read, and
 *             none of them declares this field.
 * `none`    — no write was found under the handler within the distance this
 *             walks. A preview endpoint genuinely writes nothing; so does a
 *             handler whose data layer the reader could not follow, and the
 *             two are not told apart here, which is why the row says what was
 *             looked for rather than what the route does.
 *
 * Declared worst first, because that order is also the order the command lists
 * them in and there is no second copy of the ranking.
 */
export const STRIP_IMPACTS = ['stored', 'unread', 'unknown', 'none'] as const;

export type StripImpact = (typeof STRIP_IMPACTS)[number];

/** One end of an exchange: who it is, and what shape it names. */
export interface ContractParty {
  service: string;
  /** Registry id of the type this end declares, or null when it declares none. */
  typeId: string | null;
  /** The node whose source a reader would open. */
  symbol: string;
  /**
   * The top-level keys this end actually writes, when an object in the source
   * says so.
   *
   * The type above is what this end is *permitted* to send; this is what it
   * does send. A `Partial<T>` parameter permits every key of `T` and a call
   * that writes three of them writes three, and the difference is the
   * difference between a finding and a sentence about nothing (R34). Absent
   * wherever the body was passed by name, which is most of the time.
   */
  writes?: readonly string[];
  /**
   * True when one object is written for this boundary rather than one per
   * caller.
   *
   * Three callers each writing `{ role }`, `{ isActive }` and `{ permissions }`
   * put all three keys on the wire between them and none of them on every
   * request, so "always sent" is as wrong about them as it was about a type
   * (R34).
   */
  writesEvery?: boolean;
}

/** One disagreement between two shapes, as the comparator found it. */
export interface FieldDiff {
  kind: FindingKind;
  /** Dotted path from the top of the type; `items[].price`. `''` is the whole type. */
  path: string;
  /** Receiver-side wire type, or null when the receiver declares none. */
  expected: string | null;
  /** Sender-side wire type, or null when nothing is sent. */
  actual: string | null;
  /** Wire rule that decided or softened this, when one did. */
  rule: string | null;
  /** Which end may leave the field out, on an `optionality_mismatch`. */
  optionalOn?: Side;
  /** A clause the general sentence for this kind does not cover. */
  note?: string | null;
  /** The whole sentence, with neither service named. */
  message: string;
}

/** One disagreement, placed on the edge it was found on. */
export interface ContractFinding {
  severity: Severity;
  kind: FindingKind;
  edge: { from: string; to: string; type: string };
  edgeKey: string;
  direction: Direction;
  sender: ContractParty;
  receiver: ContractParty;
  /** The declared contract, which is the receiver's type. P12 keys on it. */
  typeId: string;
  /** Dotted path, `''` for a mismatch of the whole type. */
  field: string;
  expected: string | null;
  actual: string | null;
  rule: string | null;
  /** What the receiver throwing this field away can cost. Only on a strip. */
  impact?: StripImpact;
  message: string;
  /** True when an annotation or the configuration says this drift is deliberate. */
  ignored: boolean;
  /** What said so: a symbol id, or `config:contracts.ignoreEdges`. */
  ignoredBy: string | null;
}

/** One direction of one boundary edge, and what came of checking it. */
export interface ContractEdgeResult {
  edge: { from: string; to: string; type: string };
  edgeKey: string;
  direction: Direction;
  status: ContractStatus;
  sender: ContractParty;
  receiver: ContractParty;
  findings: ContractFinding[];
  /** Ids of the wire rules that changed what was compared, with their paths. */
  rulesApplied: string[];
}

/** Why a direction could not be compared at all. */
export const UNCHECKED_REASONS = [
  'no-type-on-sender',
  'no-type-on-receiver',
  'body-already-serialised',
  'type-missing',
  'type-kind-unsupported',
  'ambiguous-handler',
  'channel-without-producer',
  'channel-without-consumer',
] as const;

export type UncheckedReason = (typeof UNCHECKED_REASONS)[number];

/**
 * A boundary nobody could check, with what would make it checkable.
 *
 * Never left out: a direction is in `edges` or in here, never in neither, so
 * "no errors" can be read as "nothing broken" rather than "nothing looked at".
 */
export interface UncheckedEdge {
  edge: { from: string; to: string; type: string };
  edgeKey: string;
  direction: Direction;
  reason: UncheckedReason;
  message: string;
  hint: string;
}

export interface ContractSummary {
  edges: number;
  shared: number;
  identical: number;
  hash_differs: number;
  unchecked: number;
  errors: number;
  warnings: number;
  infos: number;
  ignored: number;
}

export interface ContractReport {
  contractsFormatVersion: number;
  schemaVersion: number;
  generatedAt: string;
  edges: ContractEdgeResult[];
  findings: ContractFinding[];
  /** Findings an annotation or the configuration excused. Never counted as errors. */
  ignored: ContractFinding[];
  unchecked: UncheckedEdge[];
  summary: ContractSummary;
}

/**
 * How deep a nested comparison goes before it settles for a hash.
 *
 * Three levels, like the registry's own depth: a recursive shape has to stop
 * somewhere, and below the cut a hash still proves equality even though it
 * cannot name a field (I5).
 */
export const DEFAULT_DEPTH = 3;

export interface CheckOptions {
  /** How far to walk into nested shapes. Default 3. */
  depth?: number;
  /** Wire rules to switch off, by id. */
  disableRules?: readonly string[];
  /** Edge keys to treat as deliberately drifting, for code nobody can annotate. */
  ignoreEdges?: readonly string[];
  /** False to report `@ContractIgnore`d findings as ordinary ones. */
  honourIgnore?: boolean;
  /**
   * Markers on a symbol the graph did not record.
   *
   * The extractor records `meta.markers` and this is only asked when it did
   * not. Passed in rather than read here, so this package still touches no
   * files (D5).
   */
  markersOf?: (symbol: string) => readonly string[];
  /** Fixed timestamp, for output that is the same on two runs. */
  generatedAt?: string;
  /** Graph schema version to record. Read from the graph when it carries one. */
  schemaVersion?: number;
}

/**
 * What a check needs to know about the graph.
 *
 * Structural rather than a class, so both an in-memory `ProjectGraph` and the
 * database reader satisfy it, and this package depends on neither.
 */
export interface GraphLookup {
  node(id: string): GraphNode | undefined;
  edgesFrom(id: string, types?: readonly string[]): GraphEdge[];
  edgesTo(id: string, types?: readonly string[]): GraphEdge[];
  type(id: string): TypeEntry | undefined;
  allEdges(): GraphEdge[];
  nodesByType(type: string, kind?: string): GraphNode[];
  schemaVersion?(): number;
}
