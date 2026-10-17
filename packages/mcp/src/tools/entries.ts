import { normalizePath, type GraphNode } from '@flowatlas/core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { projectDetail, truncate } from '../query/detail.js';
import { rankMatches } from '../query/names.js';
import { nextFor, withNext } from '../query/next.js';
import {
  bound,
  commonInput,
  inService,
  nextOutput,
  nodeOutput,
  pagedNext,
  pageInput,
  pageOutput,
  READ_ONLY,
  serviceInput,
  withDb,
  type ToolContext,
} from './common.js';

/** Kinds of entry the model knows about, for filtering. */
const ENTRY_KINDS = [
  'http',
  'bot_command',
  'bot_callback',
  'bot_event',
  'scene_step',
  'event',
  'rpc',
  'cron',
  'invoke',
  'workflow',
] as const;

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Service, then kind, then the key it is registered under. */
const inReadingOrder = (a: GraphNode, b: GraphNode): number =>
  cmp(a.repo, b.repo) || cmp(a.kind ?? '', b.kind ?? '') || cmp(a.label, b.label);

/**
 * Fuzzy match and near names live with the resolver (`query/names.ts`), so a
 * name an error suggests is ranked the way every lookup ranks it (P94).
 */
export { nearNames, rankMatches, type Ranked } from '../query/names.js';

/** What list_entries answers: one page of entries, and how many there are. */
export const listEntriesOutput = {
  entries: z.array(nodeOutput),
  ...pageOutput,
  note: z.string().optional(),
  next: nextOutput,
};

/** What find_symbol answers: one page of matches, best first. */
export const findSymbolOutput = {
  matches: z.array(nodeOutput),
  total: pageOutput.total.optional(),
  nextOffset: pageOutput.nextOffset,
  truncated: pageOutput.truncated,
  note: z.string().optional(),
  next: nextOutput,
};

export const registerEntries = (server: McpServer, ctx: ToolContext): void => {
  server.registerTool(
    'list_entries',
    {
      title: 'List entry points',
      description: 'Every way in: routes, procedures, bot commands, jobs, message handlers.',
      inputSchema: {
        service: serviceInput,
        kind: z.enum(ENTRY_KINDS).optional(),
        pathPrefix: z.string().optional().describe('routes under this path'),
        ...commonInput,
        ...pageInput,
      },
      outputSchema: listEntriesOutput,
      annotations: READ_ONLY,
    },
    (input) =>
      withDb(ctx.handle, (db) => {
        const { detail, maxNodes, note } = bound(input);
        const prefix = input.pathPrefix === undefined ? undefined : normalizePath(input.pathPrefix);
        const all = db
          .nodesByType('entry', input.kind)
          .filter(inService(input.service))
          .filter((entry) => {
            if (prefix === undefined) return true;
            const path = normalizePath(String(entry.meta?.['path'] ?? ''));
            return path === prefix || path.startsWith(prefix === '/' ? '/' : `${prefix}/`);
          })
          .sort(inReadingOrder);

        const { items, total, truncated, nextOffset } = truncate(all, maxNodes, input.offset);
        const args = { service: input.service, kind: input.kind, pathPrefix: input.pathPrefix, detail: input.detail, maxNodes };
        return withNext(
          {
            entries: items.map((entry) => projectDetail(entry, detail)),
            total,
            ...(nextOffset === undefined ? {} : { truncated, nextOffset }),
            ...(note === undefined ? {} : { note }),
          },
          pagedNext({ tool: 'list_entries', args, nextOffset }, nextFor(items[0])),
        );
      }),
  );

  server.registerTool(
    'find_symbol',
    {
      title: 'Find a symbol',
      description: 'Any node by part of its name or id, or initials ("ocs": OrderCreationService).',
      inputSchema: {
        query: z.string(),
        types: z.array(z.string()).optional().describe('node types'),
        service: serviceInput,
        ...commonInput,
        ...pageInput,
      },
      outputSchema: findSymbolOutput,
      annotations: READ_ONLY,
    },
    (input) =>
      withDb(ctx.handle, (db) => {
        if (input.query.trim().length < 2) return { matches: [], note: 'query too short' };
        const { detail, maxNodes, note } = bound(input);

        const pool = db.search(input.query, {
          ...(input.types === undefined ? {} : { types: input.types }),
          limit: Math.max((input.offset + maxNodes) * 4, 200),
        });
        const wider = pool.length > 0 ? pool : db.nodesByType('method');
        const ranked = rankMatches(
          wider.filter(inService(input.service)),
          input.query,
        );

        const { items, total, truncated, nextOffset } = truncate(ranked, maxNodes, input.offset);
        const args = { query: input.query, types: input.types, service: input.service, detail: input.detail, maxNodes };
        return withNext(
          {
            matches: items.map((match) => projectDetail(match.node, detail)),
            total,
            ...(nextOffset === undefined ? {} : { truncated, nextOffset }),
            ...(note === undefined ? {} : { note }),
          },
          pagedNext({ tool: 'find_symbol', args, nextOffset }, nextFor(items[0]?.node)),
        );
      }),
  );
};
