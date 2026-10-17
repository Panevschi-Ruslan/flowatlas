import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { projectDetail } from '../query/detail.js';
import { isResolved, resolveSymbol } from '../query/entry-ref.js';
import { nearNames } from '../query/names.js';
import { MAX_NEXT, nextFor, withNext } from '../query/next.js';
import { nextOutput, nodeOutput, READ_ONLY, withDb, type ToolContext } from './common.js';

/**
 * Where a declaration ends, read by counting braces from where it starts.
 *
 * The graph records where things begin and not where they end, and re-parsing a
 * file to answer one question would cost more than it is worth. Counting is
 * approximate inside a string or a comment containing an unmatched brace; the
 * answer is then a few lines long or short, which a reader can see.
 */
/**
 * The most lines one symbol may answer with, however the counting goes.
 *
 * Generous for a method and short of a context window for a file, which is the
 * failure this stops: a declaration whose braces never balance used to return
 * everything below it.
 */
export const MAX_LINES = 400;

export const endOfDeclaration = (lines: readonly string[], startIndex: number, limit = MAX_LINES): number => {
  let depth = 0;
  let seen = false;
  for (let index = startIndex; index < lines.length; index += 1) {
    for (const character of lines[index] ?? '') {
      if (character === '{') {
        depth += 1;
        seen = true;
      } else if (character === '}') depth -= 1;
    }
    if (seen && depth <= 0) return index;
    if (!seen && index > startIndex + 40) return index;
    // A brace that never closes — one inside a string literal is enough — used
    // to fall through to the end of the file. The tool that says it is the only
    // one returning source was then the only one with no ceiling on how much,
    // and the server's own instructions tell the agent every answer is bounded.
    if (index > startIndex + limit) return index;
  }
  return Math.min(lines.length - 1, startIndex + limit);
};

/**
 * The lines of a declaration one answer gives, and whether it goes on (P93).
 *
 * The declaration is found whole, then a window of at most `maxLines` is cut
 * from `fromLine` (1-based, in the file) or from where it starts. A
 * declaration longer than the window says so and names the line to ask from,
 * where it used to stop at the ceiling and give an `endLine` that read as the
 * end. Line indexes here are 0-based.
 */
export const sourceWindow = (
  lines: readonly string[],
  start: number,
  options: { fromLine?: number; maxLines: number; context: number },
): { from: number; to: number; end: number; continues: boolean } => {
  const end = endOfDeclaration(lines, start, Number.POSITIVE_INFINITY);
  const first = options.fromLine === undefined ? start : Math.max(options.fromLine - 1, start);
  // Asked from past the end: nothing more to give, and where it ended.
  if (first > end) return { from: first, to: first - 1, end, continues: false };
  // Context widens only the outer edges of the declaration, never a page in its middle.
  const from = first === start ? Math.max(start - options.context, 0) : first;
  const last = Math.min(first + options.maxLines - 1, end);
  const continues = last < end;
  const to = continues ? last : Math.min(end + options.context, lines.length - 1);
  return { from, to, end, continues };
};

/**
 * What get_source answers: the code of one symbol, or the part of it asked
 * for; or, for a name that means more than one, the candidates (P94).
 */
export const getSourceOutput = {
  id: z.string().optional(),
  file: z.string().optional(),
  line: z.number().optional(),
  endLine: z.number().optional(),
  code: z.string().optional(),
  candidates: z.array(nodeOutput).optional(),
  truncated: z.string().optional(),
  note: z.string().optional(),
  next: nextOutput,
};

export const registerSource = (server: McpServer, ctx: ToolContext): void => {
  server.registerTool(
    'get_source',
    {
      title: 'Read the source of a symbol',
      description: 'The code of one symbol; the only tool that returns source.',
      inputSchema: {
        symbol: z.string().describe('node id or name'),
        context: z.number().int().min(0).max(50).default(0).describe('lines either side'),
        fromLine: z.number().int().min(1).max(1000000).optional().describe('read on from this line'),
        maxLines: z.number().int().min(1).max(MAX_LINES).default(MAX_LINES),
      },
      outputSchema: getSourceOutput,
      annotations: READ_ONLY,
    },
    (input) =>
      withDb(ctx.handle, (db) => {
        // By id, a route said aloud, or a name that is the only best match (P94 D1).
        const found = resolveSymbol(db, input.symbol);
        if (!isResolved(found)) {
          if (found.candidates.length > 0) {
            return withNext(
              { candidates: found.candidates.map((node) => projectDetail(node, 1)) },
              found.candidates.slice(0, MAX_NEXT).map((node) => `get_source({symbol: ${JSON.stringify(node.id)}})`),
            );
          }
          const near = nearNames(db.allNodes(), input.symbol, 5);
          return withNext(
            { error: `no symbol matches ${JSON.stringify(input.symbol)}`, suggestions: near.map((node) => projectDetail(node, 1)) },
            near.slice(0, MAX_NEXT).map((node) => `get_source({symbol: ${JSON.stringify(node.id)}})`),
          );
        }
        const node = found.node;
        if (node.file === undefined) return { error: 'source unavailable', reason: 'the node records no file' };

        const root = ctx.handle.repoDir(node.repo);
        if (root === undefined) {
          return { error: 'source unavailable', reason: `no repository configured for ${node.repo}`, file: node.file };
        }
        const path = join(root, node.file);
        if (!existsSync(path)) return { error: 'source unavailable', file: path };

        const lines = readFileSync(path, 'utf8').split('\n');
        const start = Math.max((node.line ?? 1) - 1, 0);
        const window = sourceWindow(lines, start, {
          ...(input.fromLine === undefined ? {} : { fromLine: input.fromLine }),
          maxLines: input.maxLines,
          context: input.context,
        });
        const past = window.from > window.end;

        return withNext(
          {
            id: node.id,
            file: node.file,
            line: window.from + 1,
            endLine: past ? window.end + 1 : window.to + 1,
            code: lines.slice(window.from, window.to + 1).join('\n'),
            ...(window.continues
              ? { truncated: `declaration continues past line ${window.to + 1}; ask with fromLine ${window.to + 2}` }
              : {}),
            ...(past ? { note: `the declaration ends at line ${window.end + 1}` } : {}),
          },
          [
            ...(window.continues
              ? [`get_source({symbol: ${JSON.stringify(node.id)}, fromLine: ${window.to + 2}})`]
              : []),
            ...nextFor(node).filter((hint) => !hint.startsWith('get_source')),
          ].slice(0, MAX_NEXT),
        );
      }),
  );
};
