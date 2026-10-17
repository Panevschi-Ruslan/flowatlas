/**
 * Types for `steps.js`, which stays plain JavaScript because the page runs its
 * text as it is. Only the test reads these.
 */
import type { GraphModel } from './graph.js';
import type { PackedGraph } from './pack.js';
import type { PackedFail } from './fails.js';
import type { PackedAccessOf } from './access.js';
import type { PackedFailuresSeen } from './observed.js';
import type { PromptLimits, PromptSubject, PROMPT_WALK } from '@flowatlas/core';

type PromptWalk = typeof PROMPT_WALK;

export interface StepLog {
  level: string;
  line: number;
  text: string;
}

export type StepKind = 'handler' | 'view' | 'act' | 'service' | 'db' | 'http' | 'channel' | 'lambda' | 'workflow'
  | 'config' | 'answer' | 'break' | 'other';

export declare const STEP_KINDS: Readonly<Record<StepKind, Readonly<{ glyph: string; say: string }>>>;
export type StepMode = 'compact' | 'detailed' | 'waterfall';
export declare const STEP_MODES: readonly StepMode[];
export declare const STEP_BOUNDS: Readonly<{ depth: number; rows: number }>;

export interface StepRow {
  node: number;
  depth: number;
  edge: number;
  parent: number;
  kind: StepKind;
  inline: string;
  confidence: string;
  certain: boolean;
  failure: boolean;
  together: boolean;
  again: boolean;
  loop: boolean;
  crosses: boolean;
  seen: number;
  /** How often traffic went through the best guess into this step (P110), 0 when it is not one or was not seen. */
  confirmed: number;
  /** When this step is a node the code runs and traffic never touched (P110): over which hours, and how sure. */
  never: { window: string; strong: boolean } | null;
  answer: { kind: string; status: string; ref: number } | null;
  /** The loop this step runs once per item of (`for-of`, `map`), '' when none. */
  perItem: string;
  /** A query-in-loop row flags this call: likely N+1. */
  nPlusOne: boolean;
  /** What the way in fails with that this step throws or checks. */
  throws: readonly PackedFail[];
  /** The lines this step logs. */
  logs: readonly StepLog[];
  /** On a `break` row: the check row's reason and message, '' when the break is structural. */
  reason?: string;
  message?: string;
  /** Where the step starts on a waterfall in steps, not time, in units from the way in's start (P99). */
  start: number;
  /** How many units wide it is: one for a step nothing runs under, its children's width otherwise, 0 for a mark. */
  span: number;
  /** How long it takes, in milliseconds, when run time says so: P111 adds it. */
  ms?: number;
}

export interface Seen {
  any: boolean;
  most: number;
  unmatched: ReadonlyArray<{ service?: string; kind: string; name: string; next?: string }>;
  ambiguous: ReadonlyArray<SeenAmbiguous>;
  join(edge: number): { count: number; lastSeen: string } | null;
  entry(node: number): number;
  /** A way in's statuses against what it declares (P106), or null. */
  failures(node: number): PackedFailuresSeen | null;
  /** The hours the file holds, in words (`2h`), '' without a file (P110). */
  window: string;
  /** What the code runs and traffic never touched (P110), strong ones flagged. */
  neverSeen: ReadonlyArray<{ node: number; strong: boolean }>;
  never(node: number): { window: string; strong: boolean } | null;
  /** How often traffic went through a best guess (P110); 0 when not one, or not seen. */
  confirmed(edge: number): number;
}

/** A span that fit several places: `places` are edge positions for a `join`, node positions otherwise. */
export interface SeenAmbiguous {
  service?: string;
  kind: string;
  name: string;
  count: number;
  places: number[];
  unnamed: number;
}

export interface StepOptions {
  depth?: number;
  rows?: number;
  /** False leaves out the settings a step reads; listed by default. */
  config?: boolean;
  answersOf?: (model: GraphModel, i: number) => Array<{ kind: string; status: string; ref: number }>;
  seen?: Seen;
}

/** What a prompt is gathered and written with (P97): the walk's bounds, what was seen, and core's renderer. */
export interface PromptKit {
  walk: PromptWalk;
  seen?: Seen;
  render: (subject: PromptSubject, limits?: Partial<PromptLimits>) => string;
  limits?: Partial<PromptLimits>;
  /** `close`: a check is written as a task for an agent (P122's Copy for agent). */
  task?: 'close';
}

export type PromptTarget =
  | { entry: number }
  | { channel: number }
  | { node: number }
  | { row: number }
  | { class: number }
  | { file: [service: string, path: string] }
  | { service: string };

/** What a node can be copied as (P134): itself, its class, its file, its service. */
export interface PromptScope {
  scope: 'node' | 'class' | 'file' | 'service';
  target: PromptTarget;
  /** What the scope is called: the node's or the class's label, the file's path, the service's name. */
  name: string;
}

export declare const stepField: (model: GraphModel, i: number, key: string) => unknown;
export declare const stepKindOf: (model: GraphModel, i: number) => StepKind;
export declare const stepInline: (model: GraphModel, i: number) => string;
export declare const createSeen: (
  data: Pick<PackedGraph, 'edges'> & Partial<Pick<PackedGraph, 'entryIds' | 'observed'>>,
) => Seen;
export interface StepsFound {
  rows: StepRow[];
  /** Steps left out, both ways. */
  more: number;
  /** What left them out: the depth, or the rows a waterfall holds. */
  cut: { depth: number; rows: number };
}
export declare const stepsOf: (model: GraphModel, entry: number, options?: StepOptions) => StepsFound;
export declare const stepUnits: (rows: Array<Pick<StepRow, 'parent' | 'kind' | 'together' | 'again' | 'loop'> & { start: number; span: number }>) => number;
export declare const stepBreakOf: (
  model: GraphModel,
  i: number,
) => { say: string; reason: string; message: string } | null;
export declare const stepIdOf: (model: GraphModel, i: number) => string | null;
/** `kit.limits` is needed for a service (its `maxFirst` and `maxGaps`); without it a service names nothing. */
export declare const subjectOf: (model: GraphModel, target: PromptTarget, kit: Pick<PromptKit, 'walk' | 'seen' | 'limits'>) => PromptSubject | null;
export declare const promptScopesOf: (model: GraphModel, i: number) => PromptScope[];
export declare const promptAskOf: (target: PromptTarget) => string;
export declare const promptTargetOf: (asked: string) => PromptTarget | null;
export declare const promptFor: (model: GraphModel, target: PromptTarget, kit: PromptKit) => string;
export declare const failsOf: (model: GraphModel, entry: number) => readonly PackedFail[];
export declare const ACCESS_WHERE_SAY: Readonly<Record<'global' | 'module' | 'controller' | 'route', string>>;
export declare const accessOf: (model: GraphModel, entry: number) => PackedAccessOf | null;
export declare const accessSay: (check: PackedAccessOf['g'][number]) => string;
export declare const optOutSay: (item: NonNullable<PackedAccessOf['o']>[number]) => string;
export declare const routeOfMessage: (message: string | undefined) => { method: string; path: string } | null;
export declare const likeRoute: (route: { method: string; path: string }) => string;
/** One place of a Not joined row, as the accept commands read it (P100). */
export interface AcceptPlace {
  reason: string;
  service?: string;
  /** Repo-relative; '' or absent for a row with no single place. */
  file?: string;
  line?: number;
  message?: string;
}
export declare const acceptCommandForPlace: (place: AcceptPlace) => string;
/** The `flowatlas doctor --reason <r> --max-nodes <n>` line, with `--service` when every row is in one service (P141). */
export declare const doctorCommandForReason: (reason: string, services: readonly string[], count: number) => string;
export declare const acceptCommandForLike: (place: AcceptPlace) => string | null;
export declare const failChips: (fails: readonly PackedFail[]) => string[];
/** One status and exception a way in fails with, and the places that raise it (P87). */
export interface PackedFailGroup {
  s?: number;
  x: string;
  a?: 1;
  srcs: PackedFail['src'][];
  n: number;
  sites: readonly PackedFail[];
}
export declare const failGroups: (fails: readonly PackedFail[]) => PackedFailGroup[];
export declare const failSay: (fail: PackedFail) => string;
export declare const choiceStatuses: (fail: PackedFail) => string;
/** One failure chip and what traffic said of it (P106). */
export interface FailChip {
  text: string;
  mark: '' | 'seen' | 'never' | 'undeclared' | 'expected';
  title?: string;
}
export declare const failChipsSeen: (fails: readonly PackedFail[], compared: PackedFailuresSeen | null | undefined) => FailChip[];
/** How many lines a failure line wraps to at `width` pixels; 1 for a width not laid out yet (P137). */
export declare const failChipLines: (lead: string, chips: readonly string[], width: number) => number;
export declare const failSeenSay: (group: PackedFailGroup, compared: PackedFailuresSeen | null | undefined) => string;
export declare const failWindowSay: (window: PackedFailuresSeen['window'] | undefined) => string;
export declare const unmatchedOf: (
  observed: Pick<NonNullable<PackedGraph['observed']>, 'unmatched' | 'services' | 'kinds'>,
) => Array<{ service?: string; kind: string; name: string; next?: string }>;
export declare const ambiguousOf: (
  observed: Pick<NonNullable<PackedGraph['observed']>, 'ambiguous' | 'services' | 'kinds'>,
) => SeenAmbiguous[];
export declare const logsOf: (model: GraphModel, i: number) => readonly StepLog[];
export declare const scheduleOf: (model: GraphModel, i: number) => { expression: string; zone: string } | null;
