import { CONFIDENCE_LEVELS } from '@flowatlas/core';
import { z } from 'zod';

/**
 * Version of the JSON these four commands print.
 *
 * Not the graph schema: the graph can be rebuilt at will, while a script that
 * reads `flowatlas dead --format=json` in CI breaks silently when a field moves.
 * Bump it when a field is removed or changes meaning.
 */
export const ANALYTICS_FORMAT_VERSION = 1;

const version = z.literal(ANALYTICS_FORMAT_VERSION);
const confidence = z.enum(CONFIDENCE_LEVELS);

/** Rows left out because `--max` was reached. Absent when nothing was cut. */
const truncated = z.number().int().nonnegative().optional();

const warning = z.object({ reason: z.string(), hint: z.string().optional() });

export const cycleSchema = z.object({
  id: z.string(),
  length: z.number().int().positive(),
  crossService: z.boolean(),
  services: z.array(z.string()),
  confidence,
  nodes: z.array(z.string()),
  truncatedNodes: z.number().int().positive().optional(),
  edges: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      type: z.string(),
      confidence,
      via: z.string().optional(),
    }),
  ),
  truncatedEdges: z.number().int().positive().optional(),
});

export const cyclesResultSchema = z.object({
  analyticsFormatVersion: version,
  cycles: z.array(cycleSchema),
  truncated,
  warnings: z.array(warning).optional(),
});

export const deadResultSchema = z.object({
  analyticsFormatVersion: version,
  // One value for the whole document: none of these four predicates can prove
  // a thing is unused, and a row that looked certain would be read as certain.
  confidence: z.literal('heuristic'),
  entries: z
    .array(
      z.object({
        id: z.string(),
        service: z.string(),
        kind: z.string(),
        key: z.string(),
        file: z.string().optional(),
        line: z.number().int().optional(),
        reason: z.string(),
      }),
    )
    .optional(),
  channels: z
    .array(
      z.object({
        id: z.string(),
        producers: z.array(z.string()),
        consumers: z.array(z.string()),
        reason: z.string(),
      }),
    )
    .optional(),
  providers: z
    .array(
      z.object({
        id: z.string(),
        service: z.string(),
        file: z.string().optional(),
        line: z.number().int().optional(),
        reason: z.string(),
      }),
    )
    .optional(),
  fields: z
    .array(
      z.object({
        typeId: z.string(),
        field: z.string(),
        sentOn: z.array(z.string()),
        reason: z.string(),
      }),
    )
    .optional(),
  excludedEntryKinds: z.array(z.string()),
  unresolvedInjects: z.number().int().nonnegative(),
  warnings: z.array(warning).optional(),
  truncated: z.record(z.string(), z.number().int().positive()).optional(),
});

export const configResultSchema = z.object({
  analyticsFormatVersion: version,
  flow: z.object({ selector: z.string(), entry: z.string() }).optional(),
  services: z.record(
    z.string(),
    z.array(
      z.object({
        key: z.string(),
        readAt: z.array(
          z.object({
            file: z.string().optional(),
            line: z.number().int().optional(),
            symbol: z.string(),
          }),
        ),
        via: z.string(),
      }),
    ),
  ),
  unresolvedAlongFlow: z.number().int().nonnegative(),
  truncated,
  warnings: z.array(warning).optional(),
});

export const hotspotsResultSchema = z.object({
  analyticsFormatVersion: version,
  rows: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      service: z.string(),
      label: z.string(),
      inDegree: z.number().int().positive(),
      callerServices: z.array(z.string()),
      byEdgeType: z.record(z.string(), z.number().int().positive()),
    }),
  ),
  /** How many nodes had anything pointing at them at all. */
  ranked: z.number().int().nonnegative(),
  truncated,
});

export type CyclesResult = z.infer<typeof cyclesResultSchema>;
export type DeadResult = z.infer<typeof deadResultSchema>;
export type ConfigResult = z.infer<typeof configResultSchema>;
export type HotspotsResult = z.infer<typeof hotspotsResultSchema>;
