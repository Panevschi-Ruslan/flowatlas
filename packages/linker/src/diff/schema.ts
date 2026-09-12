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
import { DIFF_FORMAT_VERSION, TYPE_FIELD_CHANGES } from './types.js';

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

/** The whole document, as `flowatlas diff` writes it. */
export const graphDiffSchema = z.strictObject({
  diffFormatVersion: z.literal(DIFF_FORMAT_VERSION),
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
});

/** Reads a document and says where it is wrong, rather than returning `any`. */
export const parseGraphDiff = (value: unknown): z.infer<typeof graphDiffSchema> =>
  graphDiffSchema.parse(value);
