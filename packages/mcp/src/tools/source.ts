import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { withDb, type ToolContext } from './common.js';

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

export const endOfDeclaration = (lines: readonly string[], startIndex: number): number => {
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
    if (index > startIndex + MAX_LINES) return index;
  }
  return Math.min(lines.length - 1, startIndex + MAX_LINES);
};

export const registerSource = (server: McpServer, ctx: ToolContext): void => {
  server.registerTool(
    'get_source',
    {
      title: 'Read the source of a symbol',
      description:
        'The actual code of one symbol. The only tool that returns source; ask for it by name once the graph has told you which name to ask for.',
      inputSchema: {
        symbol: z.string().describe('a node id'),
        context: z.number().int().min(0).max(50).default(0).describe('extra lines either side'),
      },
    },
    (input) =>
      withDb(ctx.handle, (db) => {
        const node = db.node(input.symbol.trim());
        if (node === undefined) return { error: `no symbol with id ${JSON.stringify(input.symbol)}` };
        if (node.file === undefined) return { error: 'source unavailable', reason: 'the node records no file' };

        const root = ctx.handle.repoDir(node.repo);
        if (root === undefined) {
          return { error: 'source unavailable', reason: `no repository configured for ${node.repo}`, file: node.file };
        }
        const path = join(root, node.file);
        if (!existsSync(path)) return { error: 'source unavailable', file: path };

        const lines = readFileSync(path, 'utf8').split('\n');
        const start = Math.max((node.line ?? 1) - 1, 0);
        const end = endOfDeclaration(lines, start);
        const from = Math.max(start - input.context, 0);
        const to = Math.min(end + input.context, lines.length - 1);

        return {
          id: node.id,
          file: node.file,
          line: from + 1,
          endLine: to + 1,
          code: lines.slice(from, to + 1).join('\n'),
        };
      }),
  );
};
