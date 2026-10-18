/**
 * The health check as SARIF findings (P115).
 *
 * Every section that names a place: gap and finding rows by their level
 * (P81: a note is never written, a place with nothing to join neither), calls
 * that land nowhere and annotations the graph contradicts as errors, contract
 * errors and rule violations as their own commands write them, and a service
 * nothing enters at the configuration line naming it. A row the baseline holds
 * is `unchanged`, one it does not `new`; a row `accepted.json` names is written
 * suppressed, with the note it was accepted with.
 */
import { describeAcceptedProblem, rowKindOf, type AcceptedGap, type RowKind, type Unresolved } from '@flowatlas/core';
import { hintFor } from '../doctor/hints.js';
import { noWayInSentence } from '../doctor/ways-in.js';
import type { DoctorReport, DoctorRow } from '../doctor/schema.js';
import { markerRule, noWayInRule, reasonRule } from './catalogue.js';
import { contractFinding } from './contracts.js';
import { KEYS } from './fingerprints.js';
import { sarifLevelOf } from './levels.js';
import type { NodeLookup } from './places.js';
import { ruleFindings } from './rules.js';
import type { BaselineState, SarifFinding, SarifLevel, SarifPlace, SarifSuppression } from './types.js';

/** A row `accepted.json` names, with the entry that names it. */
export interface AcceptedRow {
  row: Unresolved;
  entry: AcceptedGap;
}

export interface DoctorSarifOptions {
  lookup?: NodeLookup;
  /** The rows accepted.json took out of the report, written suppressed. */
  accepted?: readonly AcceptedRow[];
}

const sentence = (text: string): string => text.replace(/\.+$/, '');

/** What a row says, then what to do about it. */
const said = (message: string, hint: string): string =>
  hint === '' || message.includes(hint) ? message : `${sentence(message)}. ${hint}`;

const placeOfRow = (row: { service: string; file: string; line: number }): SarifPlace => ({
  ...(row.service === '' ? {} : { service: row.service }),
  file: row.file,
  ...(row.line > 0 ? { line: row.line } : {}),
});

const placeKey = (row: { service: string; file: string; line: number; reason: string }): string =>
  `${row.service}\u0000${row.file}\u0000${row.line}\u0000${row.reason}`;

/** One unresolved row, at the level its level and kind give it. */
const rowFinding = (
  row: Omit<DoctorRow, 'hint'> & { hint: string; reason: string; kind: RowKind },
  extra: { baselineState?: BaselineState; suppression?: SarifSuppression; level?: SarifLevel },
): SarifFinding => {
  const level = extra.level ?? sarifLevelOf({ from: 'unresolved', level: row.level, kind: row.kind });
  return {
    rule: reasonRule(row.reason, level ?? 'note'),
    level,
    // A row whose message is only its reason says nothing the rule does not;
    // what to do is the message then.
    message: row.message === row.reason ? row.hint : said(row.message, row.hint),
    at: placeOfRow(row),
    ...(row.service === '' ? {} : { fallbackService: row.service }),
    key: {
      kind: 'unresolved',
      value: KEYS.unresolved({
        ...(row.service === '' ? {} : { service: row.service }),
        file: row.file,
        ...(row.symbol === null ? {} : { symbol: row.symbol }),
        reason: row.reason,
      }),
    },
    ...(extra.baselineState === undefined ? {} : { baselineState: extra.baselineState }),
    ...(extra.suppression === undefined ? {} : { suppression: extra.suppression }),
    properties: { kind: row.kind, ...(row.sites > 1 ? { sites: row.sites } : {}) },
  };
};

/** Whether a baseline was read and compared, so `new` and `unchanged` mean something. */
const compared = (report: DoctorReport): boolean => report.baseline.status === 'ok' || report.baseline.status === 'grew';

export const doctorFindings = (report: DoctorReport, options: DoctorSarifOptions = {}): SarifFinding[] => {
  const findings: SarifFinding[] = [];
  const baselined = compared(report);
  const newKeys = new Set(report.baseline.newKeys);
  const stateOf = (key: string, level: string): BaselineState | undefined =>
    !baselined || level !== 'action' ? undefined : newKeys.has(key) ? 'new' : 'unchanged';

  for (const service of report.unresolved.withoutWaysIn ?? []) {
    findings.push({
      rule: noWayInRule(),
      level: sarifLevelOf({ from: 'no-way-in' }),
      message: `${noWayInSentence(service)}.`,
      at: undefined,
      fallbackService: service.service,
      key: { kind: 'no-way-in', value: service.service },
    });
  }

  // A call that lands nowhere is said once, as the error the desync section
  // makes it, rather than again as the row under its reason.
  const desynced = new Set(report.desync.rows.map(placeKey));
  for (const group of report.unresolved.byReason) {
    for (const row of group.rows) {
      if (desynced.has(placeKey({ ...row, reason: group.reason }))) continue;
      const found = rowFinding({ ...row, reason: group.reason, kind: group.kind }, {});
      const state = stateOf(found.key.value, row.level);
      findings.push(state === undefined ? found : { ...found, baselineState: state });
    }
  }

  for (const { row, entry } of options.accepted ?? []) {
    const level = (row.level ?? 'action') as DoctorRow['level'];
    findings.push(
      rowFinding(
        {
          service: row.service ?? '',
          file: row.file,
          line: row.line,
          symbol: row.symbol ?? null,
          level,
          sites: row.sites ?? 1,
          message: row.message ?? row.reason,
          hint: hintFor(row),
          reason: row.reason,
          kind: rowKindOf(row),
        },
        { baselineState: 'unchanged', suppression: { kind: 'external', justification: entry.note } },
      ),
    );
  }

  for (const issue of report.markers.issues) {
    const level = sarifLevelOf({ from: 'marker', severity: issue.severity });
    findings.push({
      rule: markerRule(issue.code, level ?? 'warning'),
      level,
      message: said(issue.message, issue.hint),
      at: placeOfRow(issue),
      fallbackService: issue.service,
      key: { kind: 'marker', value: KEYS.marker(issue) },
      properties: { marker: issue.marker },
    });
  }

  for (const row of report.desync.rows) {
    const found: SarifFinding = {
      rule: reasonRule(row.reason, 'error'),
      level: sarifLevelOf({ from: 'desync' }),
      message: said(row.message, row.hint),
      at: placeOfRow(row),
      fallbackService: row.service,
      key: {
        kind: 'unresolved',
        value: KEYS.unresolved({ service: row.service, file: row.file, ...(row.call === '' ? {} : { symbol: row.call }), reason: row.reason }),
      },
      properties: {
        kind: 'gap',
        ...(row.method === null || row.path === null ? {} : { call: `${row.method} ${row.path}` }),
        ...(row.targetService === null ? {} : { targetService: row.targetService }),
      },
    };
    const state = stateOf(found.key.value, 'action');
    findings.push(state === undefined ? found : { ...found, baselineState: state });
  }

  for (const finding of report.contracts.errors) {
    findings.push(contractFinding(finding, options.lookup === undefined ? {} : { lookup: options.lookup }));
  }

  const ruleNew = new Map([...report.rules.violations, ...report.rules.unchecked].map((item) => [item.key, item.new]));
  findings.push(
    ...ruleFindings({ violations: report.rules.violations, unchecked: report.rules.unchecked }, {
      ...(options.lookup === undefined ? {} : { lookup: options.lookup }),
      baselineState: (item) => (!baselined ? undefined : ruleNew.get(item.key) === true ? 'new' : 'unchanged'),
    }),
  );
  return findings;
};

/** Rows the report had already cut, by section. */
export const doctorCut = (report: DoctorReport): number =>
  report.unresolved.byReason.reduce((sum, group) => sum + (group.truncated ?? 0), 0) +
  (report.markers.truncated ?? 0) +
  (report.desync.truncated ?? 0) +
  (report.contracts.truncated ?? 0) +
  (report.rules.truncated ?? 0);

/** What the report says of itself that is no one result: why it is partial, and the verdict. */
export const doctorNotes = (report: DoctorReport): Array<{ level: SarifLevel; text: string }> => [
  ...(report.note === null ? [] : [{ level: 'warning' as const, text: report.note }]),
  ...(report.contracts.note === null ? [] : [{ level: 'warning' as const, text: report.contracts.note }]),
  ...(report.markers.note === null ? [] : [{ level: 'note' as const, text: report.markers.note }]),
  ...(report.unresolved.accepted?.problem === undefined
    ? []
    : [{ level: 'warning' as const, text: `${describeAcceptedProblem(report.unresolved.accepted.problem)}; every gap is counted as new` }]),
  ...(report.baseline.status === 'missing' || report.baseline.status === 'invalid'
    ? [{ level: 'warning' as const, text: report.baseline.note ?? `baseline ${report.baseline.status}` }]
    : []),
  ...report.rules.notes.map((note) => ({ level: 'note' as const, text: `${note.rule}: ${note.message} (${note.reason})` })),
  ...report.verdict.reasons.map((reason) => ({ level: report.verdict.exitCode === 0 ? ('note' as const) : ('error' as const), text: `verdict: ${reason}` })),
];
