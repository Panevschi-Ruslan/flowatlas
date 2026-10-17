/**
 * The shape of `diff.json`, checked rather than assumed.
 *
 * Not the graph schema: a graph can be rebuilt at will, while a pipeline
 * reading this file to decide whether to block a merge breaks silently when a
 * field moves. It carries its own version for that reason, and unknown keys are
 * refused so a typo in a hand-edited file is an error and not a silent default.
 */
import { contractFindingSchema } from '@flowatlas/contracts';
import { z } from 'zod';
import { CHECK_FORMAT_VERSION, CHECK_REASON_KINDS, CHECK_REFUSALS, CHECK_VERDICTS, DIFF_WARNINGS } from './report.js';
import { CONFIDENCE_LEVELS, PIN_SOURCES } from '@flowatlas/core';
import type { CheckReport, DiffReport } from './report.js';
import { ruleViolationSchema } from '../rules/schema.js';
import { specDiffReportSchema } from '../spec-diff/schema.js';
import { FLOW_SIDES, PARTICIPANT_KINDS, STEP_KINDS, STEP_STATUSES } from './sequence.js';
import { DIFF_FORMAT_VERSION, GAP_REF_KINDS, LOST_JOIN_KINDS, TYPE_FIELD_CHANGES } from './types.js';

const edgeRefSchema = z.strictObject({
  from: z.string().min(1),
  to: z.string().min(1),
  type: z.string().min(1),
});

const nodeChangeSchema = z.strictObject({
  id: z.string().min(1),
  service: z.string(),
  label: z.string(),
  fields: z.array(z.string()),
});

const edgeChangeSchema = z.strictObject({
  key: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  type: z.string().min(1),
  fields: z.array(z.string()),
});

const typeFieldChangeSchema = z.strictObject({
  field: z.string(),
  change: z.enum(TYPE_FIELD_CHANGES),
  optional: z.boolean(),
  base: z.string().nullable(),
  head: z.string().nullable(),
  rule: z.string().nullable(),
  message: z.string().min(1),
});

const typeChangeSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string(),
  baseHash: z.string(),
  headHash: z.string(),
  fieldDiff: z.array(typeFieldChangeSchema),
});

const unresolvedCountSchema = z.strictObject({
  rows: z.number().int().min(0),
  sites: z.number().int().min(0),
});

const graphCountsSchema = z.strictObject({
  nodes: z.number().int().min(0),
  edges: z.number().int().min(0),
  types: z.number().int().min(0),
  unresolved: unresolvedCountSchema,
});

const blastEntrySchema = z.strictObject({
  id: z.string().min(1),
  service: z.string(),
  kind: z.string(),
  type: z.string(),
  label: z.string(),
  file: z.string().nullable(),
  line: z.number().int().nullable(),
  depth: z.number().int().min(0),
  confidence: z.enum(CONFIDENCE_LEVELS),
});

const blastRowSchema = z.strictObject({
  node: z.string().min(1),
  service: z.string(),
  label: z.string(),
  side: z.enum(['head', 'base']),
  entries: z.array(blastEntrySchema),
  counts: z.record(z.string(), z.number().int().min(0)),
  truncated: z.number().int().min(0),
  services: z.array(z.string()),
  servicesWithoutEntry: z.array(z.string()),
  reached: z.number().int().min(0),
  partial: z.boolean(),
});

const sourceSchema = z.strictObject({
  sha: z.string().nullable(),
  ref: z.string().nullable(),
  cached: z.boolean(),
  nodeModules: z.enum(['linked', 'present', 'missing']),
});

const sideSchema = z.strictObject({
  ref: z.string().nullable(),
  services: z.record(z.string(), sourceSchema),
});

const warningSchema = z.strictObject({
  reason: z.enum(DIFF_WARNINGS),
  service: z.string().nullable(),
  message: z.string().min(1),
  hint: z.string(),
});

const gapRefSchema = z.strictObject({
  id: z.string().min(1),
  kind: z.enum(GAP_REF_KINDS),
  service: z.string(),
  file: z.string(),
  line: z.number().int().min(1).optional(),
  reason: z.string().min(1),
  node: z.string().min(1).optional(),
  sites: z.number().int().min(1),
  /** Optional, so formats 2 and 3 read with and without it (P194). */
  kept: z.number().int().min(0).optional(),
});

const lostJoinSchema = z.strictObject({
  kind: z.enum(LOST_JOIN_KINDS),
  caller: z.string().min(1),
  target: z.string().min(1),
  edge: z.string().min(1),
  service: z.string(),
  targetService: z.string().nullable(),
  now: z.string().min(1),
  targetRemoved: z.boolean(),
});

const participantSchema = z.strictObject({
  id: z.string().min(1),
  label: z.string(),
  kind: z.enum(PARTICIPANT_KINDS),
  service: z.string().optional(),
});

const stepSchema = z.strictObject({
  status: z.enum(STEP_STATUSES),
  kind: z.enum(STEP_KINDS),
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string(),
  confidence: z.enum(CONFIDENCE_LEVELS),
  file: z.string().optional(),
  line: z.number().int().min(0).optional(),
  params: z.array(z.string()).optional(),
  returns: z.string().optional(),
  takes: z.array(z.string()).optional(),
  group: z
    .strictObject({
      kind: z.enum(['loop', 'par']),
      id: z.string().min(1),
      label: z.string(),
      branch: z.number().int().min(0).optional(),
    })
    .optional(),
  note: z.string().min(1).optional(),
});

const stepCount = z.number().int().min(0);

const flowChangeSchema = z.strictObject({
  entry: z.string().min(1),
  label: z.string(),
  service: z.string(),
  side: z.enum(FLOW_SIDES),
  reaches: z.number().int().min(0),
  participants: z.array(participantSchema),
  steps: z.array(stepSchema),
  counts: z.strictObject({ same: stepCount, added: stepCount, removed: stepCount, changed: stepCount }),
  truncated: z.string().min(1).optional(),
});

/** Every section of format 1, which every later format keeps. */
const formatOneShape = {
  schemaVersion: z.number().int().positive(),
  generatedAt: z.string().min(1),
  base: sideSchema,
  head: sideSchema,
  nodes: z.strictObject({
    added: z.array(z.string()),
    removed: z.array(z.string()),
    changed: z.array(nodeChangeSchema),
    moved: z.array(z.string()),
  }),
  edges: z.strictObject({
    added: z.array(edgeRefSchema),
    removed: z.array(edgeRefSchema),
    changed: z.array(edgeChangeSchema),
  }),
  types: z.strictObject({
    added: z.array(z.string()),
    removed: z.array(z.string()),
    changed: z.array(typeChangeSchema),
  }),
  counts: z.strictObject({ base: graphCountsSchema, head: graphCountsSchema }),
  impact: z.array(blastRowSchema),
  contracts: z.strictObject({
    new: z.array(contractFindingSchema),
    fixed: z.array(contractFindingSchema),
    preexisting: z.array(contractFindingSchema),
    ignored: z.array(contractFindingSchema),
  }),
  warnings: z.array(warningSchema),
  timing: z.strictObject({
    baseMs: z.number().int().min(0),
    headMs: z.number().int().min(0),
    diffMs: z.number().int().min(0),
    totalMs: z.number().int().min(0),
  }),
};

/** The sections format 2 added (P96), which every later format keeps. */
const formatTwoShape = {
  unresolved: z.strictObject({ added: z.array(gapRefSchema), removed: z.array(gapRefSchema) }),
  joins: z.strictObject({ lost: z.array(lostJoinSchema) }),
};

/** The section format 3 added (P116), which every later format keeps. */
const formatThreeShape = {
  flows: z.array(flowChangeSchema),
};

/** The section format 4 added (P114), which every later format keeps. */
const formatFourShape = {
  rules: z.strictObject({
    new: z.array(ruleViolationSchema),
    fixed: z.array(ruleViolationSchema),
    existing: z.array(ruleViolationSchema),
    excused: z.array(ruleViolationSchema),
  }),
};

/** Format 1, as flowatlas wrote it before P96: read, never written. */
export const graphDiffSchemaV1 = z.strictObject({ diffFormatVersion: z.literal(1), ...formatOneShape });

/** Format 2, as flowatlas wrote it before P116: read, never written. */
export const graphDiffSchemaV2 = z.strictObject({ diffFormatVersion: z.literal(2), ...formatOneShape, ...formatTwoShape });

/** Format 3, as flowatlas wrote it before P114: read, never written. */
export const graphDiffSchemaV3 = z.strictObject({
  diffFormatVersion: z.literal(3),
  ...formatOneShape,
  ...formatTwoShape,
  ...formatThreeShape,
});

/** Format 4, as flowatlas wrote it before P118: read, never written. */
export const graphDiffSchemaV4 = z.strictObject({
  diffFormatVersion: z.literal(4),
  ...formatOneShape,
  ...formatTwoShape,
  ...formatThreeShape,
  ...formatFourShape,
});

/** The whole document, as `flowatlas diff` writes it: the current format. */
export const graphDiffSchema = z.strictObject({
  diffFormatVersion: z.literal(DIFF_FORMAT_VERSION),
  ...formatOneShape,
  ...formatTwoShape,
  ...formatThreeShape,
  ...formatFourShape,
  spec: specDiffReportSchema.nullable(),
});

/**
 * How each older format is read: its own schema, and the lift that brings a
 * document of it one format up, the sections it predates empty and its
 * `diffFormatVersion` kept as written. A bump adds the outgoing format's
 * schema here and one lift; every older one is then read through the chain.
 */
const OLDER: Readonly<Record<number, { schema: z.ZodType; lift: (doc: Record<string, unknown>) => Record<string, unknown> }>> = {
  1: {
    schema: graphDiffSchemaV1,
    lift: (doc) => ({ ...doc, unresolved: { added: [], removed: [] }, joins: { lost: [] } }),
  },
  2: {
    schema: graphDiffSchemaV2,
    lift: (doc) => ({ ...doc, flows: [] }),
  },
  3: {
    schema: graphDiffSchemaV3,
    lift: (doc) => ({ ...doc, rules: { new: [], fixed: [], existing: [], excused: [] } }),
  },
  // Not computed, which is what `null` says: format 4 had no `--spec`.
  4: {
    schema: graphDiffSchemaV4,
    lift: (doc) => ({ ...doc, spec: null }),
  },
};

/**
 * Reads a document and says where it is wrong, rather than returning `any`.
 *
 * The current format is checked as written; an older one is checked against
 * its own schema and lifted to the current shape, so every reader handles one
 * shape and `sectionsMissing` says what the document never had. A newer
 * format is refused by name: guessing at sections this build does not know
 * would be reading a document it cannot.
 */
export const parseGraphDiff = (value: unknown): DiffReport => {
  const version = (value as { diffFormatVersion?: unknown } | null)?.diffFormatVersion;
  if (version === DIFF_FORMAT_VERSION) return graphDiffSchema.parse(value) as DiffReport;
  if (typeof version === 'number' && version > DIFF_FORMAT_VERSION) {
    throw new Error(
      `diff.json is format ${version}, written by a newer flowatlas; this one reads formats 1 to ${DIFF_FORMAT_VERSION}`,
    );
  }
  const older = typeof version === 'number' ? OLDER[version] : undefined;
  if (older === undefined) {
    throw new Error(`diff.json has no diffFormatVersion this flowatlas reads (${JSON.stringify(version)})`);
  }
  let doc = older.schema.parse(value) as Record<string, unknown>;
  for (let at = version as number; at < DIFF_FORMAT_VERSION; at += 1) {
    const step = OLDER[at];
    if (step === undefined) throw new Error(`diff.json format ${at} has no lift to ${at + 1}`);
    doc = step.lift(doc);
  }
  return doc as unknown as DiffReport;
};

/* ── `check.<env>.json` (P117) ── */

const checkPlaceSchema = z.strictObject({
  service: z.string(),
  file: z.string(),
  line: z.number().int().min(0).optional(),
});

const checkReasonSchema = z.strictObject({
  kind: z.enum(CHECK_REASON_KINDS),
  code: z.string().min(1),
  message: z.string().min(1),
  key: z.string().min(1),
  service: z.string().nullable(),
  at: checkPlaceSchema.optional(),
  confidence: z.enum(CONFIDENCE_LEVELS),
  heuristic: z.boolean(),
});

const pinFromSchema = z.enum(PIN_SOURCES);

const checkShape = {
  checkFormatVersion: z.literal(CHECK_FORMAT_VERSION),
  generatedAt: z.string().min(1),
  environment: z.string().min(1),
  pinsFile: z.string().nullable(),
  pins: z.array(
    z.strictObject({
      service: z.string().min(1),
      ref: z.string().min(1),
      from: pinFromSchema,
      sha: z.string().nullable(),
      replaced: z.strictObject({ ref: z.string().min(1), from: pinFromSchema }).optional(),
    }),
  ),
  notDeployed: z.array(z.string()),
  moved: z.array(
    z.strictObject({
      service: z.string().min(1),
      from: z.strictObject({ ref: z.string().nullable(), sha: z.string().nullable() }),
      to: z.strictObject({ ref: z.string().nullable(), sha: z.string().nullable(), dirty: z.boolean() }),
    }),
  ),
  head: z.string().nullable(),
  verdict: z.strictObject({
    verdict: z.enum(CHECK_VERDICTS),
    reasons: z.array(checkReasonSchema),
    already: z.array(checkReasonSchema),
    undecided: z.array(
      z.strictObject({
        reason: z.enum(CHECK_REFUSALS),
        service: z.string().nullable(),
        message: z.string().min(1),
        hint: z.string(),
      }),
    ),
    notes: z.array(z.string()),
  }),
};

/** The whole check document as `flowatlas check` writes it: its `diff` in the current diff format. */
export const checkReportSchema = z.strictObject({ ...checkShape, diff: graphDiffSchema.nullable() });

/**
 * Reads a check document; its `diff` is read like any `diff.json`, older
 * formats lifted, so a reader of either sees one `DiffReport`.
 */
export const parseCheckReport = (value: unknown): CheckReport => {
  const version = (value as { checkFormatVersion?: unknown } | null)?.checkFormatVersion;
  if (typeof version === 'number' && version > CHECK_FORMAT_VERSION) {
    throw new Error(`check document is format ${version}, written by a newer flowatlas; this one reads format ${CHECK_FORMAT_VERSION}`);
  }
  const outer = z.strictObject({ ...checkShape, diff: z.unknown() }).parse(value);
  return { ...outer, diff: outer.diff === null || outer.diff === undefined ? null : parseGraphDiff(outer.diff) } as CheckReport;
};

/** Whether a document is a check document rather than a `diff.json`. */
export const isCheckDocument = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && 'checkFormatVersion' in value;
