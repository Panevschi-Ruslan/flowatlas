/**
 * The change between two revisions' API documents, sorted into kinds and
 * weighed by the callers it breaks (P118).
 */
export { compareSchemas, schemaSaid } from './compare.js';
export type { SchemaSide } from './compare.js';
export { diffSpecs, SPEC_FAIL_LEVELS, specFailures } from './diff.js';
export type { SpecDiffOptions, SpecFailLevel, SpecUseContext } from './diff.js';
export { parseSpecAgainst, parseSpecDiff, specAgainstReportSchema, specCallerSchema, specChangeSchema, specChangeUseSchema, specDiffReportSchema } from './schema.js';
export { AGAINST_NOT_COMPARED, declaredSpecs, SPEC_AGAINST_FILE, SPEC_AGAINST_FORMAT_VERSION, specAgainst } from './against.js';
export type { AgainstDocument, CommittedDocument, SpecAgainstReport } from './against.js';
export {
  NO_CALLER_NOTE,
  SPEC_CHANGE_DIRECTIONS,
  SPEC_CHANGE_KIND_NAMES,
  SPEC_CHANGE_KINDS,
  SPEC_CHANGE_LEVELS,
  SPEC_DIFF_FILE,
  SPEC_DIFF_FORMAT_VERSION,
  SPEC_FLOW_STEPS,
  SPEC_USE_HOWS,
} from './types.js';
export type {
  SpecAnchor,
  SpecChange,
  SpecChangeDirection,
  SpecChangeKind,
  SpecChangeKindInfo,
  SpecChangeLevel,
  SpecChangeUse,
  SpecCoverage,
  SpecDeployOrder,
  SpecDiffReport,
  SpecDiffSummary,
  SpecFlowStep,
  SpecFlowStepKind,
  SpecUseHow,
  SpecUseReader,
} from './types.js';
