/**
 * Contract checking: what one service sends against what another declares.
 *
 * Pure. It reads a graph and answers a report — no files, no processes, no
 * repository — so `doctor`, `diff` and the server all ask it the same question
 * and none of them has to own a copy of the answer.
 */
export { boundaries, namesAShape } from './boundary.js';
export type { Exchange } from './boundary.js';
export { bySeverity, checkContracts, errorsOf } from './check.js';
export { compareTypes, diffRefs, diffTypes, hasWireAnnotation } from './compare.js';
export type { CompareOptions, CompareResult } from './compare.js';
export { edgeKeyOf, findingKey } from './key.js';
export { asLookup, isProjectGraph, lookupOf } from './lookup.js';
export { summarizeForDoctor, uncheckedHint, UNCHECKED_HINTS } from './doctor.js';
export type { DoctorSummary } from './doctor.js';
export { describeDiff } from './message.js';
export type { Parties } from './message.js';
export { createContractChecker } from './mcp-hook.js';
export type { ContractChecker, ContractCheckerInput } from './mcp-hook.js';
export {
  contractEdgeResultSchema,
  contractFindingSchema,
  contractReportSchema,
  parseContractReport,
  uncheckedEdgeSchema,
} from './schema.js';
export { atLeast, severityOf, SEVERITY_RANK } from './severity.js';
export { STRIP_IMPACTS } from './types.js';
export {
  CONTRACT_STATUSES,
  CONTRACTS_FORMAT_VERSION,
  DEFAULT_DEPTH,
  DIRECTIONS,
  FINDING_KINDS,
  SEVERITIES,
  UNCHECKED_REASONS,
} from './types.js';
export type {
  CheckOptions,
  ContractEdgeResult,
  ContractFinding,
  ContractParty,
  ContractReport,
  ContractStatus,
  ContractSummary,
  Direction,
  FieldDiff,
  FindingKind,
  GraphLookup,
  StripImpact,
  Severity,
  Side,
  UncheckedEdge,
  UncheckedReason,
} from './types.js';
export { uncheckedNote } from './unchecked.js';
export type { UncheckedNote } from './unchecked.js';
export {
  anyUnknownSkip,
  applyWireRules,
  bigintString,
  bufferString,
  classTransformer,
  dateString,
  objectidString,
  setMapJson,
  undefinedVanishes,
  viewOf,
  WIRE_RULES,
} from './wire/index.js';
export type { FieldView, WireOptions, WireRule } from './wire/index.js';
