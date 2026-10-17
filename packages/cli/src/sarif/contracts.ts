/**
 * Contract findings as SARIF findings (P115).
 *
 * The sender is the primary location and the receiver a related one: the
 * receiver declares what it needs, which is its right, so the end that has to
 * change is the one that sends (D3, as `doctor --format github` decides). A
 * finding something excused is still written, suppressed, so code scanning
 * shows it dismissed rather than new.
 */
import type { ContractFinding, ContractParty } from '@flowatlas/contracts';
import { placeOf } from '../doctor/render.js';
import { contractRule } from './catalogue.js';
import { KEYS } from './fingerprints.js';
import { sarifLevelOf } from './levels.js';
import { nodePlace, type NodeLookup } from './places.js';
import type { BaselineState, SarifFinding, SarifPlace, SarifSuppression } from './types.js';

/**
 * Where one end of a boundary is declared: the node its symbol names, read
 * off the graph with its line, or the file the symbol's id is built from.
 */
export const partyPlace = (party: ContractParty, lookup?: NodeLookup): SarifPlace | undefined => {
  const node = lookup?.node(party.symbol);
  if (node?.file !== undefined) return nodePlace(node);
  const parsed = placeOf(party.symbol);
  return parsed === undefined ? undefined : { service: party.service, file: parsed.file, line: parsed.line };
};

/** Why a finding is excused: an annotation in the code, or the configuration. */
const suppressionOf = (finding: ContractFinding): SarifSuppression | undefined => {
  if (!finding.ignored) return undefined;
  const by = finding.ignoredBy ?? '';
  return by.startsWith('config:')
    ? { kind: 'external', justification: `excused by ${by.slice('config:'.length)} in flowatlas.config.json` }
    : { kind: 'inSource', justification: by === '' ? 'excused by @ContractIgnore' : `excused by @ContractIgnore on ${by}` };
};

export interface ContractFindingOptions {
  lookup?: NodeLookup;
  baselineState?: BaselineState;
}

export const contractFinding = (finding: ContractFinding, options: ContractFindingOptions = {}): SarifFinding => {
  const level = sarifLevelOf({ from: 'contract', severity: finding.severity });
  const sender = partyPlace(finding.sender, options.lookup);
  const receiver = partyPlace(finding.receiver, options.lookup);
  // The sender when it can be placed; the receiver when only it can.
  const at = sender ?? receiver;
  const other = sender === undefined ? undefined : { place: receiver, message: `receiver ${finding.receiver.service}` };
  const suppression = suppressionOf(finding);
  return {
    rule: contractRule(finding.kind, level ?? 'note'),
    level,
    message: `${finding.sender.service} → ${finding.receiver.service}: ${finding.message}`,
    at,
    fallbackService: finding.sender.service,
    ...(other === undefined || other.place === undefined ? {} : { related: [other] }),
    key: { kind: 'contract', value: KEYS.contract(finding) },
    ...(options.baselineState === undefined ? {} : { baselineState: options.baselineState }),
    ...(suppression === undefined ? {} : { suppression }),
    properties: {
      direction: finding.direction,
      edge: finding.edgeKey,
      ...(finding.field === '' ? {} : { field: finding.field }),
      ...(finding.impact === undefined ? {} : { impact: finding.impact }),
    },
  };
};

/** A contract report's findings and the ones it excused. */
export const contractFindings = (
  report: { findings: readonly ContractFinding[]; ignored?: readonly ContractFinding[] },
  options: ContractFindingOptions = {},
): SarifFinding[] => [
  ...report.findings.map((finding) => contractFinding(finding, options)),
  ...(report.ignored ?? []).map((finding) => contractFinding(finding, options)),
];
