import { missingGroupsOf, worthSaying, type GraphDb } from '@flowatlas/linker';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { nextFor, withNext } from '../query/next.js';
import { blindSpotsBeside } from '../query/observed.js';
import { staleDocsCount } from '../query/docs.js';
import { START_LIMITS, summariseProject, type StartSummary } from '../query/start.js';
import { nextOutput, nodeOutput, READ_ONLY, serviceInput, withDb, type ToolContext } from './common.js';

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
  staleDocs: z.number().optional(),
  missingRepos: z.array(z.object({ token: z.string(), candidates: z.array(z.string()).optional() })).optional(),
  next: nextOutput,
};

/** How many repositories probably missing `start_here` names (P122); `flowatlas doctor --missing` lists them all. */
const MISSING_NAMED = 3;

/**
 * The repositories probably missing (P122): the likeliest few worth saying,
 * by name, with the directories that look like each where the command line
 * can look. For one service, those whose evidence is in it. Traffic from a
 * service nobody configured counts too, with an observed file beside (P144).
 */
const missingReposOf = (db: GraphDb, ctx: ToolContext, service?: string): Array<{ token: string; candidates?: string[] }> => {
  const groups = missingGroupsOf(db, [...db.allUnresolved(), ...blindSpotsBeside(ctx.handle.path)]).filter(
    (group) => service === undefined || group.signals.some((signal) => signal.places.some((place) => place.service === service)),
  );
  const candidates = ctx.missingCandidates?.(groups) ?? [];
  return groups
    .map((group, index) => ({ group, found: candidates[index] ?? [] }))
    .filter(({ group, found }) => worthSaying(group, found.length))
    .slice(0, MISSING_NAMED)
    .map(({ group, found }) => ({ token: group.token, ...(found.length === 0 ? {} : { candidates: found }) }));
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
        // Doc blocks that no longer say what the graph says (P120), when `flowatlas docs` has indexed any.
        const staleDocs = staleDocsCount(db, ctx.handle.path, input.service);
        const missingRepos = missingReposOf(db, ctx, input.service);
        return withNext(
          { ...summary, ...(staleDocs === undefined ? {} : { staleDocs }), ...(missingRepos.length === 0 ? {} : { missingRepos }) },
          nextFor(
            summary.startFrom[0],
            lonely === undefined ? undefined : { id: lonely, type: 'channel' },
          ).slice(0, 3),
        );
      }),
  );
};
