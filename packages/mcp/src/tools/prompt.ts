import type { GraphNode } from '@flowatlas/core';
import type { GraphDb } from '@flowatlas/linker';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { projectDetail } from '../query/detail.js';
import { isResolved, resolveEntryRef } from '../query/entry-ref.js';
import { withNext } from '../query/next.js';
import { describeForPrompt, PROMPT_LIMITS } from '../prompt/describe.js';
import { gatherPromptSubject } from '../prompt/gather.js';
import { rankMatches } from './entries.js';
import { READ_ONLY, withDb, type ToolContext } from './common.js';

/**
 * The node an id names: as it is, as a channel without its prefix, or as an
 * entry said aloud. Anything else is a list of near names, never a guess.
 */
const subjectOf = (db: GraphDb, ref: string): GraphNode | GraphNode[] => {
  const trimmed = ref.trim();
  const exact = db.node(trimmed) ?? db.node(`channel:${trimmed}`);
  if (exact !== undefined) return exact;
  const entry = resolveEntryRef(db, trimmed);
  if (isResolved(entry)) return entry.node;
  if (entry.candidates.length > 0) return entry.candidates;
  return rankMatches(db.search(trimmed, { limit: 200 }), trimmed)
    .slice(0, 5)
    .map((match) => match.node);
};

export const registerPrompt = (server: McpServer, ctx: ToolContext): void => {
  server.registerTool(
    'describe_for_prompt',
    {
      title: 'Describe for a prompt',
      description: 'An entry, channel or symbol as Markdown to hand on; no code.',
      inputSchema: {
        id: z.string().describe('any id, channel or "POST /orders"'),
        maxSteps: z.number().int().min(1).max(200).default(PROMPT_LIMITS.maxSteps).describe('chain steps'),
        maxChars: z.number().int().min(500).max(40000).default(PROMPT_LIMITS.maxChars),
      },
      annotations: READ_ONLY,
    },
    (input) =>
      withDb(ctx.handle, (db) => {
        const found = subjectOf(db, input.id);
        if (Array.isArray(found)) {
          return found.length === 0
            ? { error: `nothing matches ${JSON.stringify(input.id)}` }
            : withNext(
                { candidates: found.map((node) => projectDetail(node, 1)) },
                found.slice(0, 2).map((node) => `describe_for_prompt({id: ${JSON.stringify(node.id)}})`),
              );
        }
        const subject = gatherPromptSubject(db, found);
        const markdown = describeForPrompt(subject, { ...PROMPT_LIMITS, maxSteps: input.maxSteps, maxChars: input.maxChars });
        return withNext({ id: found.id, markdown }, subject.askNext);
      }),
  );
};
