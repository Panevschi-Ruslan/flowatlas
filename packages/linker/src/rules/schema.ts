/**
 * The shape of a rule violation and of `rules.json`, checked rather than
 * assumed (P114): `diff.json` holds violations from format 4, and a pipeline
 * reading either file breaks silently when a field moves.
 */
import { CONFIDENCE_LEVELS, RULE_SEVERITIES, RULE_SHAPES } from '@flowatlas/core';
import { z } from 'zod';
import { RULE_STATUSES, RULES_FORMAT_VERSION, type RulesReport } from './types.js';

export const ruleHopSchema = z.strictObject({
  from: z.string().min(1),
  to: z.string().min(1),
  type: z.string().min(1),
  confidence: z.enum(CONFIDENCE_LEVELS),
});

export const ruleViolationSchema = z.strictObject({
  rule: z.string().min(1),
  shape: z.enum(RULE_SHAPES),
  severity: z.enum(RULE_SEVERITIES),
  note: z.string().min(1).optional(),
  key: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  fromService: z.string(),
  toService: z.string().nullable(),
  via: z.string().min(1),
  path: z.array(ruleHopSchema),
  at: z.strictObject({ service: z.string(), file: z.string(), line: z.number().int().min(0).optional() }).optional(),
  confidence: z.enum(CONFIDENCE_LEVELS),
  heuristic: z.boolean(),
  message: z.string().min(1),
  partial: z.array(z.string()).optional(),
  excusedBy: z.string().optional(),
});

export const ruleUncheckedSchema = z.strictObject({
  rule: z.string().min(1),
  shape: z.enum(RULE_SHAPES),
  severity: z.enum(RULE_SEVERITIES),
  key: z.string().min(1),
  reason: z.literal('rule-matches-nothing'),
  side: z.string().min(1),
  selector: z.string(),
  message: z.string().min(1),
});

const count = z.number().int().min(0);

export const rulesReportSchema = z.strictObject({
  rulesFormatVersion: z.literal(RULES_FORMAT_VERSION),
  rules: z.array(
    z.strictObject({
      name: z.string().min(1),
      shape: z.enum(RULE_SHAPES),
      severity: z.enum(RULE_SEVERITIES),
      note: z.string().min(1).optional(),
      status: z.enum(RULE_STATUSES),
      matched: z.record(z.string(), count),
      violations: count,
      excused: count,
      walkCut: z.literal(true).optional(),
    }),
  ),
  violations: z.array(ruleViolationSchema),
  excused: z.array(ruleViolationSchema),
  unchecked: z.array(ruleUncheckedSchema),
  notes: z.array(
    z.strictObject({ rule: z.string().min(1), reason: z.literal('rule-over-partial-read'), service: z.string(), message: z.string().min(1) }),
  ),
  summary: z.strictObject({
    rules: count,
    held: count,
    broken: count,
    unchecked: count,
    errors: count,
    warnings: count,
    infos: count,
    heuristic: count,
    excused: count,
  }),
});

/** Reads `rules.json` back, or says which field is wrong. */
export const parseRulesReport = (value: unknown): RulesReport => rulesReportSchema.parse(value) as RulesReport;
