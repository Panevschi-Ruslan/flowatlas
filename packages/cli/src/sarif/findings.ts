/**
 * What looks broken, as SARIF findings (P384): every row the `findings`
 * answer ranks, under a rule per kind (`finding/<kind>`) that carries the
 * kind's precision as CodeQL's `@precision` does, and placed where the row
 * says. How loud each is follows from how sure it is: `high` is an error,
 * `medium` a warning, `low` a note. The key is the kind and both ends without
 * their lines, so a finding keeps its fingerprint across edits.
 */
import type { Precision } from '@flowatlas/core';
import type { FindingRow } from '@flowatlas/linker';
import { KEYS } from './fingerprints.js';
import type { SarifFinding, SarifLevel, SarifRuleInfo } from './types.js';

/** How loud a finding is, by how sure it is. */
export const LEVEL_OF_PRECISION: Readonly<Record<Precision, SarifLevel>> = { high: 'error', medium: 'warning', low: 'note' };

/** What each kind is, in a few words, and what to do about it. */
const FINDING_HELP: Readonly<Record<string, readonly [short: string, help: string]>> = Object.freeze({
  'call-to-missing-route': [
    'call to a route the service does not serve',
    'Every route of the target was read and none answers this request: the route was renamed or removed on one side. Correct the address to the nearest route named, or restore the route.',
  ],
  'field-never-sent': [
    'field read that no sender sends',
    'The receiving code reads a field no sender on the crossing sends: usually a field renamed on one side. Send it, or read the field the sender names.',
  ],
  'answer-field-never-returned': [
    'field of an answer read that the route never returns',
    "The client reads a field of a route's answer that the answer's declared shape does not hold: usually a field renamed on one side. Return it, or read the field the route answers.",
  ],
  'type-never-published': [
    'type of message handled that nothing publishes',
    'Every publish on the channel says the type it sends, and none sends this one: the handler waits for a message that never comes. Correct the type on one side.',
  ],
  'contract-break': [
    'contract break between two services',
    'The two ends declare the boundary differently. `flowatlas contracts --edge <key>` shows it.',
  ],
  'unguarded-among-guarded': [
    'route unguarded while the routes beside it are guarded',
    'The other routes of its controller have a guard in front; this one has none. Add the guard, or mark it public with the reason.',
  ],
  'annotation-to-missing-route': [
    'annotation naming a route the service does not serve',
    'Every route of the service the annotation names was read and none is the one it names. Correct the annotation.',
  ],
  'env-not-set': [
    'value read from an environment the deployment does not set',
    'The deployment of the code that reads it was read and does not set it. Set it there, or read the name it is set under; a value set outside the files (a secret store) makes this wrong.',
  ],
  'n-plus-one': ['query, request or publish once per item of a loop', 'Batch it, or say why it is per item.'],
  unguarded: ['route with no guard in front of it', 'Add a guard, or mark it public; an internal route only other services call may be unguarded by design.'],
  'one-ended-channel': ['channel with one end only', 'Add the missing end, or remove the one that is there.'],
});

/** A kind of finding as a rule, with its precision. */
export const findingRule = (kind: string, precision: Precision): SarifRuleInfo => {
  const known = Object.hasOwn(FINDING_HELP, kind) ? FINDING_HELP[kind] : undefined;
  return {
    id: `finding/${kind}`,
    short: known?.[0] ?? kind.replace(/[-_]+/g, ' '),
    help: known?.[1] ?? 'See every one with `flowatlas findings --kind <kind>`.',
    level: LEVEL_OF_PRECISION[precision],
    properties: { precision },
  };
};

const placeOf = (row: FindingRow): SarifFinding['at'] => {
  if (row.loc === undefined) return undefined;
  const found = /^(.*):(\d+)$/.exec(row.loc);
  return {
    ...(row.service === '' ? {} : { service: row.service }),
    file: found === null ? row.loc : (found[1] ?? row.loc),
    ...(found === null ? {} : { line: Number(found[2]) }),
  };
};

/** One ranked finding as a SARIF finding. */
export const findingResult = (row: FindingRow): SarifFinding => ({
  rule: findingRule(row.kind, row.precision),
  level: LEVEL_OF_PRECISION[row.precision],
  message: [row.message, row.fix].filter((part): part is string => part !== undefined).join('. '),
  at: placeOf(row),
  ...(row.service === '' ? {} : { fallbackService: row.service }),
  key: { kind: 'finding', value: KEYS.finding(row) },
  properties: { precision: row.precision, rank: row.rank, ...(row.evidence === undefined ? {} : { evidence: row.evidence }) },
});

export const findingResults = (rows: readonly FindingRow[]): SarifFinding[] => rows.map(findingResult);
