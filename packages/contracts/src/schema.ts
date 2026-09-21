/**
 * The shape of `contracts.json`, checked rather than assumed.
 *
 * Not the graph schema: the graph can be rebuilt at will, while a script
 * reading this file in CI, or `doctor` embedding it, breaks silently when a
 * field moves. It carries its own version for that reason, and unknown keys are
 * refused so a typo in a hand-edited file is an error and not a silent default.
 */
import { z } from 'zod';
import {
  CONTRACT_STATUSES,
  CONTRACTS_FORMAT_VERSION,
  DIRECTIONS,
  FINDING_KINDS,
  SEVERITIES,
  STRIP_IMPACTS,
  UNCHECKED_REASONS,
} from './types.js';

const edgeShape = z.strictObject({
  from: z.string().min(1),
  to: z.string().min(1),
  type: z.string().min(1),
});

const partySchema = z.strictObject({
  service: z.string(),
  typeId: z.string().nullable(),
  symbol: z.string(),
  /** Top-level keys an object written at the call site puts on the wire (R34). */
  writes: z.array(z.string()).optional(),
  /** False when the keys are one object per caller rather than one object (R34). */
  writesEvery: z.boolean().optional(),
});

export const contractFindingSchema = z.strictObject({
  severity: z.enum(SEVERITIES),
  kind: z.enum(FINDING_KINDS),
  edge: edgeShape,
  edgeKey: z.string().min(1),
  direction: z.enum(DIRECTIONS),
  sender: partySchema,
  receiver: partySchema,
  typeId: z.string(),
  field: z.string(),
  expected: z.string().nullable(),
  actual: z.string().nullable(),
  rule: z.string().nullable(),
  impact: z.enum(STRIP_IMPACTS).optional(),
  message: z.string().min(1),
  ignored: z.boolean(),
  ignoredBy: z.string().nullable(),
});

export const contractEdgeResultSchema = z.strictObject({
  edge: edgeShape,
  edgeKey: z.string().min(1),
  direction: z.enum(DIRECTIONS),
  status: z.enum(CONTRACT_STATUSES),
  sender: partySchema,
  receiver: partySchema,
  findings: z.array(contractFindingSchema),
  rulesApplied: z.array(z.string()),
});

export const uncheckedEdgeSchema = z.strictObject({
  edge: edgeShape,
  edgeKey: z.string().min(1),
  direction: z.enum(DIRECTIONS),
  reason: z.enum(UNCHECKED_REASONS),
  message: z.string().min(1),
  hint: z.string().min(1),
});

export const contractReportSchema = z.strictObject({
  contractsFormatVersion: z.literal(CONTRACTS_FORMAT_VERSION),
  schemaVersion: z.number().int().nonnegative(),
  generatedAt: z.string().min(1),
  edges: z.array(contractEdgeResultSchema),
  findings: z.array(contractFindingSchema),
  ignored: z.array(contractFindingSchema),
  unchecked: z.array(uncheckedEdgeSchema),
  summary: z.strictObject({
    edges: z.number().int().nonnegative(),
    shared: z.number().int().nonnegative(),
    identical: z.number().int().nonnegative(),
    hash_differs: z.number().int().nonnegative(),
    unchecked: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
    infos: z.number().int().nonnegative(),
    ignored: z.number().int().nonnegative(),
  }),
});

/** Reads a report, or says exactly which field of it is wrong. */
export const parseContractReport = (value: unknown): z.infer<typeof contractReportSchema> =>
  contractReportSchema.parse(value);
