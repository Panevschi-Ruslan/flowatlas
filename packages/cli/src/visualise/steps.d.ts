/**
 * Types for `steps.js`, which stays plain JavaScript because the page runs its
 * text as it is. Only the test reads these.
 */
import type { GraphModel } from './graph.js';
import type { PackedGraph } from './pack.js';
import type { PackedFail } from './fails.js';
import type { PackedAccessOf } from './access.js';
import type { PromptLimits, PromptSubject, PROMPT_WALK } from '@flowatlas/core';

type PromptWalk = typeof PROMPT_WALK;

export interface StepLog {
  level: string;
  line: number;
  text: string;
}

export type StepKind = 'handler' | 'service' | 'db' | 'http' | 'channel' | 'lambda' | 'workflow' | 'answer' | 'break' | 'other';

export declare const STEP_KINDS: Readonly<Record<StepKind, Readonly<{ glyph: string; say: string }>>>;
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
}

export interface Seen {
  any: boolean;
  most: number;
  unmatched: ReadonlyArray<{ service?: string; kind: string; name: string }>;
  ambiguous: ReadonlyArray<SeenAmbiguous>;
  join(edge: number): { count: number; lastSeen: string } | null;
  entry(node: number): number;
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
  answersOf?: (model: GraphModel, i: number) => Array<{ kind: string; status: string; ref: number }>;
  seen?: Seen;
}

/** What a prompt is gathered and written with (P97): the walk's bounds, what was seen, and core's renderer. */
export interface PromptKit {
  walk: PromptWalk;
  seen?: Seen;
  render: (subject: PromptSubject, limits?: Partial<PromptLimits>) => string;
  limits?: Partial<PromptLimits>;
}

export type PromptTarget =
  | { entry: number }
  | { channel: number }
  | { node: number }
  | { row: number }
  | { class: number }
  | { file: [service: string, path: string] };

export declare const stepField: (model: GraphModel, i: number, key: string) => unknown;
export declare const stepKindOf: (model: GraphModel, i: number) => StepKind;
export declare const stepInline: (model: GraphModel, i: number) => string;
export declare const createSeen: (
  data: Pick<PackedGraph, 'edges'> & Partial<Pick<PackedGraph, 'entryIds' | 'observed'>>,
) => Seen;
export declare const stepsOf: (model: GraphModel, entry: number, options?: StepOptions) => { rows: StepRow[]; more: number };
export declare const stepBreakOf: (
  model: GraphModel,
  i: number,
) => { say: string; reason: string; message: string } | null;
export declare const stepIdOf: (model: GraphModel, i: number) => string | null;
export declare const subjectOf: (model: GraphModel, target: PromptTarget, kit: Pick<PromptKit, 'walk' | 'seen'>) => PromptSubject | null;
export declare const promptFor: (model: GraphModel, target: PromptTarget, kit: PromptKit) => string;
export declare const failsOf: (model: GraphModel, entry: number) => readonly PackedFail[];
export declare const ACCESS_WHERE_SAY: Readonly<Record<'global' | 'module' | 'controller' | 'route', string>>;
export declare const accessOf: (model: GraphModel, entry: number) => PackedAccessOf | null;
export declare const accessSay: (check: PackedAccessOf['g'][number]) => string;
export declare const optOutSay: (item: NonNullable<PackedAccessOf['o']>[number]) => string;
export declare const routeOfMessage: (message: string | undefined) => { method: string; path: string } | null;
export declare const likeRoute: (route: { method: string; path: string }) => string;
export declare const acceptCommandFor: (row: { reason: string; service?: string; message?: string }) => string;
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
export declare const unmatchedOf: (
  observed: Pick<NonNullable<PackedGraph['observed']>, 'unmatched' | 'services' | 'kinds'>,
) => Array<{ service?: string; kind: string; name: string }>;
export declare const ambiguousOf: (
  observed: Pick<NonNullable<PackedGraph['observed']>, 'ambiguous' | 'services' | 'kinds'>,
) => SeenAmbiguous[];
export declare const logsOf: (model: GraphModel, i: number) => readonly StepLog[];
export declare const scheduleOf: (model: GraphModel, i: number) => { expression: string; zone: string } | null;
