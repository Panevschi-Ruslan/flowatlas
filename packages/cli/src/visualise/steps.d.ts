/**
 * Types for `steps.js`, which stays plain JavaScript because the page runs its
 * text as it is. Only the test reads these.
 */
import type { GraphModel } from './graph.js';
import type { PackedGraph } from './pack.js';

export type StepKind = 'handler' | 'service' | 'db' | 'http' | 'channel' | 'lambda' | 'workflow' | 'answer' | 'break' | 'other';

export declare const STEP_KINDS: Readonly<Record<StepKind, Readonly<{ glyph: string; say: string }>>>;
export declare const STEP_BOUNDS: Readonly<{ depth: number; rows: number }>;
export declare const PROMPT_BOUNDS: Readonly<{ chars: number; steps: number; gaps: number; consumers: number }>;

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
  /** On a `break` row: the check row's reason and message, '' when the break is structural. */
  reason?: string;
  message?: string;
}

export interface Seen {
  any: boolean;
  most: number;
  unmatched: ReadonlyArray<{ service?: string; kind: string; name: string }>;
  join(edge: number): { count: number; lastSeen: string } | null;
  entry(node: number): number;
}

export interface KeysLike {
  keyOf(i: number): string;
  find(key: string): number;
}

export interface StepOptions {
  depth?: number;
  rows?: number;
  answersOf?: (model: GraphModel, i: number) => Array<{ kind: string; status: string; ref: number }>;
  seen?: Seen;
}

export interface PromptKit {
  keyOf(i: number): string;
  idOf?: (i: number) => string | null;
  faceLine?: (model: GraphModel, i: number) => string;
  answersOf?: StepOptions['answersOf'];
  seen?: Seen;
  chars?: number;
}

export declare const stepField: (model: GraphModel, i: number, key: string) => unknown;
export declare const stepKindOf: (model: GraphModel, i: number) => StepKind;
export declare const stepInline: (model: GraphModel, i: number) => string;
export declare const createSeen: (
  data: Pick<PackedGraph, 'edges' | 'dicts'> & Partial<Pick<PackedGraph, 'entryIds' | 'observed'>>,
  keys: KeysLike,
) => Seen;
export declare const stepsOf: (model: GraphModel, entry: number, options?: StepOptions) => { rows: StepRow[]; more: number };
export declare const stepBreakOf: (
  model: GraphModel,
  i: number,
) => { say: string; reason: string; message: string } | null;
export declare const placeOfStep: (model: GraphModel, i: number) => string;
export declare const promptFor: (
  model: GraphModel,
  target: { entry: number } | { channel: number } | { row: number },
  kit: PromptKit,
) => string;
