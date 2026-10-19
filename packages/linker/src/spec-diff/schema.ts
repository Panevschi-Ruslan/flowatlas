/**
 * The shape of `spec-diff.json` and of `diff.json`'s `spec`, checked rather
 * than assumed: a pipeline reads this to decide whether an API change may
 * merge, and a field that moved silently is the failure that matters.
 */
import { CONFIDENCE_LEVELS } from '@flowatlas/core';
import { z } from 'zod';
import { SPEC_KINDS } from '../document/written.js';
import { SPEC_AGAINST_FORMAT_VERSION, type SpecAgainstReport } from './against.js';
import { SPEC_CHANGE_KIND_NAMES, SPEC_CHANGE_LEVELS, SPEC_DIFF_FORMAT_VERSION, type SpecDiffReport } from './types.js';

const count = z.number().int().min(0);

export const specCallerSchema = z.strictObject({
  id: z.string().min(1),
  service: z.string(),
  file: z.string().optional(),
  line: z.number().int().min(0).optional(),
  confidence: z.enum(CONFIDENCE_LEVELS),
  via: z.string().min(1),
});

export const specChangeSchema = z.strictObject({
  kind: z.enum(SPEC_CHANGE_KIND_NAMES as [string, ...string[]]),
  level: z.enum(SPEC_CHANGE_LEVELS),
  document: z.string().min(1),
  format: z.enum(SPEC_KINDS),
  service: z.string().min(1),
  operation: z.string().min(1),
  field: z.string().nullable(),
  base: z.string().nullable(),
  head: z.string().nullable(),
  message: z.string().min(1),
  place: z
    .strictObject({ side: z.enum(['base', 'head']), file: z.string().min(1), line: z.number().int().min(0).optional() })
    .nullable(),
  callers: z.array(specCallerSchema),
  public: z.string().nullable(),
  note: z.string().nullable(),
  confidence: z.enum(CONFIDENCE_LEVELS),
  key: z.string().min(1),
});

export const specDiffReportSchema = z.strictObject({
  specDiffFormatVersion: z.literal(SPEC_DIFF_FORMAT_VERSION),
  documents: z.strictObject({ base: count, head: count }),
  changes: z.array(specChangeSchema),
  summary: z.strictObject({ errors: count, warnings: count, infos: count, breaking: count, uncalled: count }),
});

/** Reads a spec diff, refusing one a newer flowatlas wrote by name. */
export const parseSpecDiff = (value: unknown): SpecDiffReport => {
  const version = (value as { specDiffFormatVersion?: unknown } | null)?.specDiffFormatVersion;
  if (typeof version === 'number' && version > SPEC_DIFF_FORMAT_VERSION) {
    throw new Error(`spec-diff.json is format ${version}, written by a newer flowatlas; this one reads format ${SPEC_DIFF_FORMAT_VERSION}`);
  }
  return specDiffReportSchema.parse(value) as SpecDiffReport;
};

/** `spec-against.json` (P195): every committed document against the code. */
export const specAgainstReportSchema = z.strictObject({
  specAgainstFormatVersion: z.literal(SPEC_AGAINST_FORMAT_VERSION),
  documents: z.array(
    z.strictObject({ service: z.string().min(1), kind: z.enum(SPEC_KINDS), file: z.string().min(1), declared: count, written: count }),
  ),
  changes: z.array(specChangeSchema),
  summary: z.strictObject({ errors: count, warnings: count, infos: count, breaking: count, uncalled: count }),
});

/** Reads `spec-against.json`, refusing one a newer flowatlas wrote by name. */
export const parseSpecAgainst = (value: unknown): SpecAgainstReport => {
  const version = (value as { specAgainstFormatVersion?: unknown } | null)?.specAgainstFormatVersion;
  if (typeof version === 'number' && version > SPEC_AGAINST_FORMAT_VERSION) {
    throw new Error(`spec-against.json is format ${version}, written by a newer flowatlas; this one reads format ${SPEC_AGAINST_FORMAT_VERSION}`);
  }
  return specAgainstReportSchema.parse(value) as SpecAgainstReport;
};
