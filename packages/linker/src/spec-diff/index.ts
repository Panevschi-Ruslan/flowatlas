/**
 * The change between two revisions' API documents, sorted into kinds and
 * weighed by the callers it breaks (P118).
 */
export { compareSchemas, schemaSaid } from './compare.js';
export type { SchemaSide } from './compare.js';
export { diffSpecs, SPEC_FAIL_LEVELS, specFailures } from './diff.js';
export type { SpecDiffOptions, SpecFailLevel } from './diff.js';
export { parseSpecDiff, specCallerSchema, specChangeSchema, specDiffReportSchema } from './schema.js';
export {
  NO_CALLER_NOTE,
  SPEC_CHANGE_KIND_NAMES,
  SPEC_CHANGE_KINDS,
  SPEC_CHANGE_LEVELS,
  SPEC_DIFF_FILE,
  SPEC_DIFF_FORMAT_VERSION,
} from './types.js';
export type { SpecChange, SpecChangeKind, SpecChangeKindInfo, SpecChangeLevel, SpecDiffReport, SpecDiffSummary } from './types.js';
