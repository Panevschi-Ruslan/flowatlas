import { askNextOf, isGapId, readAccepted, type GraphNode, type PromptSubject } from '@flowatlas/core';
import { acceptedSplitOf, type GraphDb } from '@flowatlas/linker';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { projectDetail } from '../query/detail.js';
import { isResolved, resolveEntryRef } from '../query/entry-ref.js';
import { MAX_NEXT, withNext } from '../query/next.js';
import { loadObservedCounts } from '../query/observed.js';
import { describeForPrompt, PROMPT_LIMITS } from '../prompt/describe.js';
import { gatherCheckSubject, gatherPromptSubject, rowsOfGap } from '../prompt/gather.js';
import { nearNames } from './entries.js';
import { READ_ONLY, withDb, type ToolContext } from './common.js';

/**
 * The node an id names: as it is, as a channel without its prefix, or as an
 * entry said aloud. Anything else is a list of near names, never a guess.
 */
const subjectOf = (db: GraphDb, ref: string): { node: GraphNode; alsoAnswers?: string[] } | GraphNode[] => {
  const trimmed = ref.trim();
  const exact = db.node(trimmed) ?? db.node(`channel:${trimmed}`);
  if (exact !== undefined) return { node: exact };
  const entry = resolveEntryRef(db, trimmed);
  if (isResolved(entry)) return { node: entry.node, ...(entry.alsoAnswers === undefined ? {} : { alsoAnswers: entry.alsoAnswers }) };
  if (entry.candidates.length > 0) return entry.candidates;
  return nearNames(db.search(trimmed, { limit: 200 }), trimmed, 5);
};

/**
 * A check by its gap id (`gap:<service>|<file>|<reason>`), its rows as every
 * surface counts them: demoted where an annotation answered them (P80).
 */
const checkOf = (db: GraphDb, ctx: ToolContext, gapId: string): PromptSubject | undefined => {
  const rows = rowsOfGap(db.allUnresolved(), gapId);
  if (rows.length === 0) return undefined;
  const split = acceptedSplitOf(db, rows, readAccepted(ctx.handle.path));
  return gatherCheckSubject(db, gapId, rowsOfGap(split.rows, gapId));
};

const answer = (id: string, subject: PromptSubject, input: { maxSteps: number; maxChars: number }, alsoAnswers?: string[]) => {
  const next = askNextOf(subject);
  const markdown = describeForPrompt(subject, { ...PROMPT_LIMITS, maxSteps: input.maxSteps, maxChars: input.maxChars });
  return withNext({ id, ...(alsoAnswers === undefined ? {} : { alsoAnswers }), markdown }, next);
};

export const registerPrompt = (server: McpServer, ctx: ToolContext): void => {
  server.registerTool(
    'describe_for_prompt',
    {
      title: 'Describe for a prompt',
      description: 'An entry, channel, symbol or gap as Markdown to hand on; no code.',
      inputSchema: {
        id: z.string().describe('any id, gap id, channel or "POST /orders"'),
        maxSteps: z.number().int().min(1).max(200).default(PROMPT_LIMITS.maxSteps).describe('chain steps'),
        maxChars: z.number().int().min(500).max(40000).default(PROMPT_LIMITS.maxChars),
      },
      annotations: READ_ONLY,
    },
    (input) =>
      withDb(ctx.handle, (db) => {
        const trimmed = input.id.trim();
        if (isGapId(trimmed)) {
          const check = checkOf(db, ctx, trimmed);
          return check === undefined ? { error: `no rows answer to ${JSON.stringify(trimmed)}` } : answer(trimmed, check, input);
        }
        const found = subjectOf(db, input.id);
        if (Array.isArray(found)) {
          return found.length === 0
            ? { error: `nothing matches ${JSON.stringify(input.id)}` }
            : withNext(
                { candidates: found.map((node) => projectDetail(node, 1)) },
                found.slice(0, MAX_NEXT).map((node) => `describe_for_prompt({id: ${JSON.stringify(node.id)}})`),
              );
        }
        const subject = gatherPromptSubject(db, found.node, loadObservedCounts(ctx.handle.path));
        return answer(found.node.id, subject, input, found.alsoAnswers);
      }),
  );
};
