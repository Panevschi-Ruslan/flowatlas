import type { GraphDb } from '@flowatlas/linker';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { nextFor, withNext } from '../query/next.js';
import { START_LIMITS, summariseProject, type StartSummary } from '../query/start.js';
import { nextOutput, nodeOutput, READ_ONLY, serviceInput, withDb, type ToolContext } from './common.js';
import { rulesReportOf } from './rules.js';

/** A reason, how often, where, and the first place it was seen: one row of `topGaps` or `topFindings`. */
const reasonOutput = z
  .object({
    reason: z.string(),
    count: z.number(),
    services: z.array(z.string()),
    example: z.object({
      service: z.string().optional(),
      loc: z.string().optional(),
      message: z.string(),
      id: z.string().optional(),
    }),
  })
  .meta({ id: 'Reason' });

/** What start_here answers (`StartSummary`, with `next`). */
export const startOutput = {
  services: z.array(
    z.object({
      service: z.string(),
      nodes: z.number(),
      entries: z.number(),
      entriesByKind: z.record(z.string(), z.number()),
      gaps: z.number(),
    }),
  ),
  counts: z.object({
    gaps: z.number(),
    sites: z.number(),
    notes: z.number(),
    findings: z.number(),
    nothing: z.number(),
  }),
  topGaps: z.array(reasonOutput),
  topFindings: z.array(reasonOutput),
  channels: z.object({ noConsumers: z.array(z.string()), noProducers: z.array(z.string()) }),
  startFrom: z.array(nodeOutput),
  /** The architecture rules' violations by severity, and rules not checked (P114); absent with no rules. */
  rules: z.object({ errors: z.number(), warnings: z.number(), unchecked: z.number() }).optional(),
  next: nextOutput,
};

/** The services at each end of every channel, read once. */
const channelEnds = (db: GraphDb): Map<string, { producers: string[]; consumers: string[] }> => {
  const ends = new Map<string, { producers: string[]; consumers: string[] }>();
  const serviceOf = (id: string): string => db.node(id)?.repo ?? '';
  for (const channel of db.nodesByType('channel')) {
    ends.set(channel.id, {
      producers: db.edgesTo(channel.id, ['emits']).map((edge) => serviceOf(edge.from)),
      consumers: db.edgesFrom(channel.id, ['consumes']).map((edge) => serviceOf(edge.to)),
    });
  }
  return ends;
};

/**
 * What `start_here` answers, for one service or all of them: read here once
 * so the `flowatlas://services/{name}` resource (P96) says the same numbers.
 */
export const startSummaryOf = (db: GraphDb, service?: string, perService: number = START_LIMITS.perService): StartSummary =>
  summariseProject(
    {
      nodes: db.allNodes(),
      channelEnds: channelEnds(db),
      // A finding's symbol is often source text rather than a node; only an id
      // another tool would take is handed on.
      unresolved: db.allUnresolved().map((row) => (row.node === null || db.node(row.node) !== undefined ? row : { ...row, node: null })),
      ...(service === undefined ? {} : { service }),
    },
    { ...START_LIMITS, perService },
  );

export const registerStart = (server: McpServer, ctx: ToolContext): void => {
  server.registerTool(
    'start_here',
    {
      title: 'Start here',
      description: 'Begin here: counts and gaps per service, findings, one-ended channels, entry ids.',
      inputSchema: {
        service: serviceInput,
        perService: z.number().int().min(1).max(20).default(START_LIMITS.perService).describe('entry ids per service'),
      },
      outputSchema: startOutput,
      annotations: READ_ONLY,
    },
    (input) =>
      withDb(ctx.handle, (db) => {
        const summary = startSummaryOf(db, input.service, input.perService);
        const lonely = summary.channels.noConsumers[0] ?? summary.channels.noProducers[0];
        const report = rulesReportOf(db, ctx);
        const touches = (item: { fromService: string; toService: string | null }): boolean =>
          input.service === undefined || item.fromService === input.service || item.toService === input.service;
        const broken = report?.violations.filter(touches) ?? [];
        const rules =
          report === undefined
            ? undefined
            : {
                errors: broken.filter((item) => item.severity === 'error').length,
                warnings: broken.filter((item) => item.severity === 'warning').length,
                unchecked: report.unchecked.length,
              };
        return withNext(
          { ...summary, ...(rules === undefined ? {} : { rules }) },
          [
            ...(rules !== undefined && rules.errors > 0 ? [`check_rules(${input.service === undefined ? '' : `{service: ${JSON.stringify(input.service)}}`})`] : []),
            ...nextFor(summary.startFrom[0], lonely === undefined ? undefined : { id: lonely, type: 'channel' }),
          ].slice(0, 3),
        );
      }),
  );
};
