/**
 * What deploying would introduce, as SARIF findings (P117).
 *
 * Per environment: the new contract findings and rule violations the
 * candidate side has against the deployed one (the `diff` adapter's, on the
 * two sides `check` compared), every join deploying would lose, placed at
 * the end that is left behind, and every new request no deployed route serves. Each is said with its environment, and keyed
 * with it, so the same break against two environments is two alerts.
 */
import type { CheckReport, LostJoin } from '@flowatlas/linker';
import { joinRule } from './catalogue.js';
import { diffFindings } from './diff.js';
import { KEYS } from './fingerprints.js';
import { sarifLevelOf } from './levels.js';
import { nodePlace, type NodeLookup } from './places.js';
import type { SarifFinding } from './types.js';

/** One environment's check, and both sides' graphs to place its findings on. */
export interface CheckSarifInput {
  report: CheckReport;
  deployed?: NodeLookup;
  candidate?: NodeLookup;
}

const joinFinding = (join: LostJoin, environment: string, lookups: { deployed?: NodeLookup; candidate?: NodeLookup }, message: string): SarifFinding => {
  const caller = lookups.candidate?.node(join.caller) ?? lookups.deployed?.node(join.caller);
  // The route a request lost, where it was deployed; a channel is nobody's and has no place.
  const target = join.kind === 'target-gone' ? lookups.deployed?.node(join.target) : undefined;
  return {
    rule: joinRule(join.kind),
    level: sarifLevelOf({ from: 'join' }),
    message: `${environment}: ${message}`,
    at: caller?.file === undefined ? undefined : nodePlace(caller),
    ...(join.service === '' ? {} : { fallbackService: join.service }),
    ...(target?.file === undefined ? {} : { related: [{ place: nodePlace(target), message: `${target.label} (as deployed)` }] }),
    key: { kind: 'join', value: `${environment}|${KEYS.join(join)}` },
    baselineState: 'new',
    properties: { environment, edge: join.edge, now: join.now },
  };
};

export const checkFindings = (checks: readonly CheckSarifInput[]): SarifFinding[] =>
  checks.flatMap(({ report, deployed, candidate }) => {
    if (report.diff === null) return [];
    const environment = report.environment;
    const messages = new Map(report.verdict.reasons.filter((reason) => reason.kind === 'join').map((reason) => [reason.key, reason.message]));
    const found = diffFindings(report.diff, {
      ...(candidate === undefined ? {} : { head: candidate }),
      ...(deployed === undefined ? {} : { base: deployed }),
    }).map((finding) => ({
      ...finding,
      message: `${environment}: ${finding.message}`,
      key: { kind: finding.key.kind, value: `${environment}|${finding.key.value}` },
      properties: { ...finding.properties, environment },
    }));
    const joins = report.diff.joins.lost.map((join) =>
      joinFinding(join, environment, { ...(deployed === undefined ? {} : { deployed }), ...(candidate === undefined ? {} : { candidate }) }, messages.get(`join|${KEYS.join(join)}`) ?? `${join.caller} lost ${join.target}`),
    );
    // A new request no deployed route serves has no lost join to place it by: its reason has the place.
    const unjoined = report.verdict.reasons
      .filter((reason) => reason.kind === 'join' && reason.code === 'no-target')
      .map((reason): SarifFinding => ({
        rule: joinRule('no-target'),
        level: sarifLevelOf({ from: 'join' }),
        message: `${environment}: ${reason.message}`,
        at: reason.at === undefined ? undefined : { service: reason.at.service, file: reason.at.file, ...(reason.at.line === undefined ? {} : { line: reason.at.line }) },
        ...(reason.service === null ? {} : { fallbackService: reason.service }),
        key: { kind: 'join', value: `${environment}|${reason.key}` },
        baselineState: 'new',
        properties: { environment },
      }));
    return [...found, ...joins, ...unjoined];
  });
