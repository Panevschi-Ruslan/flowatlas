/**
 * The change between two revisions' API documents as SARIF findings (P118):
 * one result per change, under its kind as the rule (`spec/<kind>`, the
 * catalogue's names, D4), placed at the route or channel end it is about and
 * with every caller it breaks as a related location - which is the part no
 * document differ can write.
 *
 * With usage verdicts (P390) a result says what the change does to the code
 * that uses it: its level is the one use gives, its related locations are the
 * consumers with what each does (reads the field, omits it, takes the message
 * whole), every flow from a way in to a consumer it breaks is a code flow
 * across repositories, and a change on the base side is placed on the head
 * side - its own line where it survives, the nearest line of its file that
 * survives where it went, the configuration where the file went too - since
 * a pull request is annotated only on lines it holds.
 */
import { SPEC_CHANGE_KINDS, type SpecChange, type SpecChangeKind, type SpecFlowStep } from '@flowatlas/linker';
import { sarifLevelOf } from './levels.js';
import type { SarifFinding, SarifPlace, SarifRuleInfo, SarifStep } from './types.js';

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

const placed = (service: string, file: string | undefined, line: number | undefined): SarifPlace | undefined =>
  file === undefined ? undefined : { service, file, ...(line === undefined ? {} : { line }) };

/** One step of a flow as SARIF says it: what it is, then its name. */
const flowStep = (step: SpecFlowStep): SarifStep => ({
  place: placed(step.service, step.file, step.line),
  message: `${step.step} ${step.label} (${step.service})`,
});

/** Where the result goes: on the head side where the change is anchored there, else where the document read it. */
const placeOf = (change: SpecChange): SarifPlace | undefined => {
  const anchor = change.use?.anchor;
  if (anchor !== undefined) return anchor.how === 'summary' ? undefined : placed(change.service, anchor.file, anchor.line);
  return change.place === null ? undefined : placed(change.service, change.place.file, change.place.line);
};

const anchorSaid = (change: SpecChange): string => {
  const anchor = change.use?.anchor;
  if (anchor === undefined || anchor.how === 'same' || anchor.from === undefined) return '';
  const was = `${anchor.from.file}${anchor.from.line === undefined ? '' : `:${anchor.from.line}`}`;
  return anchor.how === 'nearest' ? ` It was at ${was} on the base side; this is the nearest line that is still there.` : ` It was at ${was} on the base side, in a file the branch removed.`;
};

export const specFinding = (change: SpecChange): SarifFinding => {
  const use = change.use;
  const related: SarifStep[] =
    use === undefined
      ? change.callers.map((caller) => ({
          place: placed(caller.service, caller.file, caller.line),
          message: `called from ${caller.service} (${caller.confidence})`,
        }))
      : use.readers.map((reader) => ({ place: placed(reader.service, reader.file, reader.line), message: `${reader.service}: ${reader.said}` }));
  const message =
    use === undefined
      ? change.message
      : `${change.message}. Use: ${use.verdict}.${use.deployOrder === undefined ? '' : ` Deploy ${use.deployOrder.said}.`}${anchorSaid(change)}`;
  return {
    rule: specRule(change.kind),
    level: sarifLevelOf({ from: 'spec', level: change.level }),
    message,
    at: placeOf(change),
    fallbackService: change.service,
    ...(related.length === 0 ? {} : { related }),
    ...(use === undefined || use.flows.length === 0 ? {} : { flows: use.flows.map((flow) => flow.map(flowStep)) }),
    key: { kind: 'spec', value: change.key },
    baselineState: change.place?.side === 'head' ? 'new' : 'updated',
    properties: {
      document: change.document,
      operation: change.operation,
      ...(change.field === null ? {} : { field: change.field }),
      confidence: change.confidence,
      callers: change.callers.length,
      ...(change.note === null ? {} : { note: change.note }),
      ...(use === undefined
        ? {}
        : {
            direction: use.direction,
            verdict: use.verdict,
            ...(use.deployOrder === undefined ? {} : { deployFirst: use.deployOrder.first }),
            ...(use.anchor === undefined ? {} : { anchor: use.anchor.how }),
          }),
    },
  };
};

export const specFindings = (changes: readonly SpecChange[]): SarifFinding[] => changes.map(specFinding);
