/**
 * The change between two revisions' API documents as SARIF findings (P118):
 * one result per change, under its kind as the rule (`spec/<kind>`, the
 * catalogue's names, D4), placed at the route or channel end it is about and
 * with every caller it breaks as a related location - which is the part no
 * document differ can write.
 */
import { SPEC_CHANGE_KINDS, type SpecChange, type SpecChangeKind } from '@flowatlas/linker';
import { sarifLevelOf } from './levels.js';
import type { SarifFinding, SarifRuleInfo } from './types.js';

/** One kind of API change, as a SARIF rule. */
export const specRule = (kind: SpecChangeKind): SarifRuleInfo => {
  const info = SPEC_CHANGE_KINDS[kind];
  return {
    id: `spec/${kind}`,
    short: info.short,
    help: info.help,
    level: sarifLevelOf({ from: 'spec', level: info.level }) ?? 'note',
  };
};

export const specFinding = (change: SpecChange): SarifFinding => ({
  rule: specRule(change.kind),
  level: sarifLevelOf({ from: 'spec', level: change.level }),
  message: change.message,
  at: change.place === null ? undefined : { service: change.service, file: change.place.file, ...(change.place.line === undefined ? {} : { line: change.place.line }) },
  fallbackService: change.service,
  ...(change.callers.length === 0
    ? {}
    : {
        related: change.callers.map((caller) => ({
          place: caller.file === undefined ? undefined : { service: caller.service, file: caller.file, ...(caller.line === undefined ? {} : { line: caller.line }) },
          message: `called from ${caller.service} (${caller.confidence})`,
        })),
      }),
  key: { kind: 'spec', value: change.key },
  baselineState: change.place?.side === 'head' ? 'new' : 'updated',
  properties: {
    document: change.document,
    operation: change.operation,
    ...(change.field === null ? {} : { field: change.field }),
    confidence: change.confidence,
    callers: change.callers.length,
    ...(change.note === null ? {} : { note: change.note }),
  },
});

export const specFindings = (changes: readonly SpecChange[]): SarifFinding[] => changes.map(specFinding);
