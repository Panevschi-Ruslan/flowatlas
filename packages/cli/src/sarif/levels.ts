/**
 * The one level map (P115): how loud each kind of finding is in a SARIF log.
 *
 * A Strategy per source, looked up by name, so every command asks the same
 * question the same way and none keeps its own copy. `undefined` means the
 * finding is not written at all: a place with nothing to join, and a note
 * (P81), which says how a reading was made and asks nobody to change anything.
 */
import type { RowKind } from '@flowatlas/core';
import { SARIF_LEVELS, type SarifLevel } from './types.js';

/** What a level is asked of: one entry per kind of report row. */
export type LevelSource =
  | { from: 'contract'; severity: 'error' | 'warning' | 'info' }
  | { from: 'unresolved'; level: 'action' | 'info' | 'nothing'; kind: RowKind }
  | { from: 'desync' }
  | { from: 'marker'; severity: 'error' | 'warning' }
  | { from: 'no-way-in' }
  | { from: 'dead' }
  | { from: 'cycle' }
  | { from: 'rule'; severity: 'error' | 'warning' | 'info' }
  | { from: 'join' }
  | { from: 'spec'; level: 'error' | 'warning' | 'info' };

type Source<F extends LevelSource['from']> = Extract<LevelSource, { from: F }>;

const SEVERITY: Readonly<Record<'error' | 'warning' | 'info', SarifLevel>> = {
  error: 'error',
  warning: 'warning',
  info: 'note',
};

/** A gap or a finding by its level; a note never (P81's classes). */
const ROW_LEVEL: Readonly<Record<'action' | 'info' | 'nothing', SarifLevel | undefined>> = {
  action: 'warning',
  info: 'note',
  nothing: undefined,
};

const LEVELS: { [F in LevelSource['from']]: (source: Source<F>) => SarifLevel | undefined } = {
  contract: (source) => SEVERITY[source.severity],
  unresolved: (source) => (source.kind === 'note' ? undefined : ROW_LEVEL[source.level]),
  // A call aimed at a route that is not there fails at run time.
  desync: () => 'error',
  marker: (source) => source.severity,
  // Said first by the verdict and deciding nothing (R170): worth seeing, not failing on.
  'no-way-in': () => 'warning',
  // Every dead row is a heuristic with the reason it fired.
  dead: () => 'note',
  cycle: () => 'warning',
  rule: (source) => SEVERITY[source.severity],
  // A call deploying would leave with nothing to join fails at run time (P117).
  join: () => 'error',
  // An API change at the level its callers gave it (P118).
  spec: (source) => SEVERITY[source.level],
};

export const sarifLevelOf = (source: LevelSource): SarifLevel | undefined =>
  (LEVELS[source.from] as (source: LevelSource) => SarifLevel | undefined)(source);

/** `error` 0, `warning` 1, `note` 2: lower is louder. */
export const levelRank = (level: SarifLevel): number => SARIF_LEVELS.indexOf(level);

/** Whether a level is at least as loud as the minimum asked for. */
export const atLeast = (level: SarifLevel, min: SarifLevel | undefined): boolean =>
  min === undefined || levelRank(level) <= levelRank(min);
