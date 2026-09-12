import { normalizePath, type GraphNode } from '@flowatlas/core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { projectDetail, truncate } from '../query/detail.js';
import { bound, commonInput, respond, withDb, type ToolContext } from './common.js';

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
] as const;

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Service, then kind, then the key it is registered under. */
const inReadingOrder = (a: GraphNode, b: GraphNode): number =>
  cmp(a.repo, b.repo) || cmp(a.kind ?? '', b.kind ?? '') || cmp(a.label, b.label);

/**
 * Fuzzy match: a substring, or the initials of a camel-cased name.
 *
 * `ocs` finds `OrderCreationService`, which is how someone types when they half
 * remember a name.
 */
const initialsOf = (text: string): string =>
  (text.match(/[A-Z]|(?<=[^A-Za-z0-9])[a-z]/g) ?? []).join('').toLowerCase();

export interface Ranked {
  node: GraphNode;
  score: number;
}

export const rankMatches = (nodes: readonly GraphNode[], query: string): Ranked[] => {
  const wanted = query.toLowerCase();
  const ranked: Ranked[] = [];
  for (const node of nodes) {
    const label = node.label.toLowerCase();
    const id = node.id.toLowerCase();
    if (label === wanted) ranked.push({ node, score: 0 });
    else if (label.startsWith(wanted)) ranked.push({ node, score: 1 });
    else if (label.includes(wanted)) ranked.push({ node, score: 2 });
    else if (initialsOf(node.label).includes(wanted)) ranked.push({ node, score: 3 });
    else if (id.includes(wanted)) ranked.push({ node, score: 4 });
  }
  return ranked.sort((a, b) => a.score - b.score || a.node.label.length - b.node.label.length || cmp(a.node.id, b.node.id));
};

export const registerEntries = (server: McpServer, ctx: ToolContext): void => {
  server.registerTool(
    'list_entries',
    {
      title: 'List entry points',
      description:
        'Every way into the project: routes, bot commands, scheduled jobs, message handlers. Filter by service, kind or path prefix.',
      inputSchema: {
        service: z.string().optional().describe('only this service'),
        kind: z.enum(ENTRY_KINDS).optional().describe('only this kind of entry'),
        pathPrefix: z.string().optional().describe('only routes whose path starts with this'),
        ...commonInput,
      },
    },
    (input) =>
      withDb(ctx.handle, (db) => {
        const { detail, maxNodes, note } = bound(input);
        const prefix = input.pathPrefix === undefined ? undefined : normalizePath(input.pathPrefix);
        const all = db
          .nodesByType('entry', input.kind)
          .filter((entry) => input.service === undefined || entry.repo === input.service)
          .filter((entry) => {
            if (prefix === undefined) return true;
            const path = normalizePath(String(entry.meta?.['path'] ?? ''));
            return path === prefix || path.startsWith(prefix === '/' ? '/' : `${prefix}/`);
          })
          .sort(inReadingOrder);

        const { items, truncated } = truncate(all, maxNodes);
        return {
          entries: items.map((entry) => projectDetail(entry, detail)),
          total: all.length,
          ...(truncated === undefined ? {} : { truncated }),
          ...(note === undefined ? {} : { note }),
        };
      }),
  );

  server.registerTool(
    'find_symbol',
    {
      title: 'Find a symbol',
      description:
        'Fuzzy search over every node by label and id. Accepts a substring or camel-case initials such as "ocs" for OrderCreationService.',
      inputSchema: {
        query: z.string().describe('what to look for'),
        types: z.array(z.string()).optional().describe('only these node types'),
        service: z.string().optional().describe('only this service'),
        maxNodes: commonInput.maxNodes,
        detail: commonInput.detail,
      },
    },
    (input) =>
      withDb(ctx.handle, (db) => {
        if (input.query.trim().length < 2) return { matches: [], note: 'query too short' };
        const { detail, maxNodes, note } = bound(input);

        const pool = db.search(input.query, {
          ...(input.types === undefined ? {} : { types: input.types }),
          limit: Math.max(maxNodes * 4, 200),
        });
        const wider = pool.length > 0 ? pool : db.nodesByType('method');
        const ranked = rankMatches(
          wider.filter((node) => input.service === undefined || node.repo === input.service),
          input.query,
        );

        const { items, truncated } = truncate(ranked, maxNodes);
        return {
          matches: items.map((match) => projectDetail(match.node, detail)),
          ...(truncated === undefined ? {} : { truncated }),
          ...(note === undefined ? {} : { note }),
        };
      }),
  );
};
