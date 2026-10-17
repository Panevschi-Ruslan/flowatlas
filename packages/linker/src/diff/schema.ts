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
import { DIFF_WARNINGS } from './report.js';
import { CONFIDENCE_LEVELS } from '@flowatlas/core';
import type { DiffReport } from './report.js';
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

/** Format 1, as flowatlas wrote it before P96: read, never written. */
export const graphDiffSchemaV1 = z.strictObject({ diffFormatVersion: z.literal(1), ...formatOneShape });

/** The whole document, as `flowatlas diff` writes it: the current format. */
export const graphDiffSchema = z.strictObject({
  diffFormatVersion: z.literal(DIFF_FORMAT_VERSION),
  ...formatOneShape,
  unresolved: z.strictObject({ added: z.array(gapRefSchema), removed: z.array(gapRefSchema) }),
  joins: z.strictObject({ lost: z.array(lostJoinSchema) }),
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
