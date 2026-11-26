import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { projectDetail } from '../query/detail.js';
import { isResolved, resolveSymbol } from '../query/entry-ref.js';
import { nearNames } from '../query/names.js';
import { MAX_NEXT, nextFor, withNext } from '../query/next.js';
import { requestsOf } from '../query/requests.js';
import { READ_ONLY, withDb, type ToolContext } from './common.js';

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

/**
 * The most characters of code one answer holds (P396). Four hundred lines of
 * a wide file ran to 16,262 characters for one `whole: true` on a real
 * project, every one of them re-sent on each later turn. Past it the window
 * ends at the last whole line under it and says, as a long declaration does,
 * the `fromLine` to read on from.
 */
export const MAX_CODE_CHARS = 6000;

/** The last line index of a window from `from` to `to` whose lines, joined, stay within `MAX_CODE_CHARS`; at least `from`. */
export const lastWithinChars = (lines: readonly string[], from: number, to: number, most = MAX_CODE_CHARS): number => {
  let chars = 0;
  for (let index = from; index <= to; index += 1) {
    chars += (lines[index]?.length ?? 0) + (index === from ? 0 : 1);
    if (chars > most) return Math.max(index - 1, from);
  }
  return to;
};

/**
 * A line a decorator ends on and nothing follows: `@Guard({ a: 1 })`, the `})`
 * closing one written over several lines, or a bare `@Optional`.
 */
const DECORATOR_ENDS = /\)\s*$|^\s*@[\w.$]+\s*$/;

export const endOfDeclaration = (lines: readonly string[], startIndex: number, limit = MAX_LINES): number => {
  let depth = 0;
  let seen = false;
  let parens = 0;
  let decorator = false;
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (parens <= 0 && depth <= 0 && /^\s*@/.test(line)) decorator = true;
    for (const character of line) {
      if (character === '{') {
        depth += 1;
        seen = true;
      } else if (character === '}') depth -= 1;
      else if (character === '(') parens += 1;
      else if (character === ')') parens -= 1;
    }
    // A declaration's recorded start is its first decorator, and a decorator
    // closes the braces of its own options (`@Guard({ roles: ['a'] })`, an
    // Angular `@Component({ ... })`) before the declaration has begun: those
    // lines belong to the answer and do not end it.
    if (decorator && parens <= 0 && depth <= 0) {
      decorator = false;
      parens = 0;
      if (DECORATOR_ENDS.test(line)) {
        depth = 0;
        seen = false;
        continue;
      }
    }
    // Braces closed inside an open parameter list (an inline type, `create(@Body() body: { … },`) do not end it (P393).
    if (seen && depth <= 0 && parens <= 0) return index;
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

/** Where a member's body is folded in a skeleton: its first line, this, and the line that closes it. */
const FOLD = ' … ';

/** Braces opened less closed on a line, counted as `endOfDeclaration` counts them. */
const braceDelta = (line: string): number => {
  let delta = 0;
  for (const character of line) {
    if (character === '{') delta += 1;
    else if (character === '}') delta -= 1;
  }
  return delta;
};

/**
 * A class's skeleton (P382): its decorators, its declaration and every
 * member's first lines, each body folded to `{ … }` on one line, every line
 * with its number in the file so a method is read on with `fromLine` or by
 * its own id. An agent asking for a class wants where its members are and
 * what they take, and was handed every body: a 400-line answer for a
 * question one signature answers. `lines` are the file's, `from` and `to`
 * the declaration's first and last index.
 */
export const classSkeleton = (lines: readonly string[], from: number, to: number): string => {
  const out: string[] = [];
  let depth = 0;
  // The class's own brace: lines inside it at its depth are members, deeper ones bodies.
  let body: number | undefined;
  let folding: { at: number; depth: number } | undefined;
  for (let index = from; index <= to; index += 1) {
    const line = lines[index] ?? '';
    const before = depth;
    depth += braceDelta(line);
    if (folding !== undefined) {
      if (depth <= folding.depth) {
        out[folding.at] = `${out[folding.at]}${FOLD}${line.trim()}`;
        folding = undefined;
      }
      continue;
    }
    if (body === undefined && /\bclass\b/.test(line) && line.includes('{')) body = before + 1;
    if (line.trim() === '') continue;
    out.push(`${index + 1}  ${line}`);
    // A member whose body goes on past its first line: folded until it closes.
    if (body !== undefined && before >= body && depth > before) folding = { at: out.length - 1, depth: before };
    // A decorator's options written over several lines, before the class: folded the same way.
    else if (body === undefined && depth > before && !/\bclass\b/.test(line)) folding = { at: out.length - 1, depth: before };
  }
  return out.join('\n');
};

/** Whether a node is a class whose skeleton answers by default: a declaration that holds members. */
const CLASS_TYPES: ReadonlySet<string> = new Set(['provider', 'module', 'guard', 'interceptor', 'pipe', 'middleware', 'ui_component']);

/**
 * What get_source answers (P94, P382): the code of one symbol, or the part of
 * it asked for, or a class's skeleton; or, for a name that means more than
 * one, the candidates. No output schema: the answer an agent is handed is the
 * code as plain text (`plain-text.ts`), which a client reads only where no
 * structured content comes with it; `verbose: true` gives this document.
 */
export interface SourceAnswer {
  id?: string;
  file?: string;
  line?: number;
  endLine?: number;
  code?: string;
  /** The code is the class's skeleton, each body folded; `whole: true` gives it all. */
  skeleton?: boolean;
  truncated?: string;
  note?: string;
}

export const registerSource = (server: McpServer, ctx: ToolContext): void => {
  server.registerTool(
    'get_source',
    {
      title: 'Read the source of a symbol',
      description: 'The code of one symbol, as text; a class as its skeleton (`whole: true` for all of it). A long one says `truncated` and the `fromLine` to read on from.',
      inputSchema: {
        symbol: z.string().describe('node id or name'),
        context: z.number().int().min(0).max(50).default(0).describe('lines either side'),
        fromLine: z.number().int().min(1).max(1000000).optional().describe('read on from this line'),
        maxLines: z.number().int().min(1).max(MAX_LINES).default(MAX_LINES),
        whole: z.boolean().optional(),
      },
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
        // A repository the team's graph holds and this machine has not checked out (P236).
        if (!existsSync(root)) {
          return {
            error: 'source unavailable',
            reason: `${node.repo} is not checked out here; the graph came from the team's (flowatlas pull)`,
            file: `${node.repo}/${node.file}${node.line === undefined ? '' : `:${node.line}`}`,
          };
        }
        if (!existsSync(path)) return { error: 'source unavailable', file: path };

        // A file checked out with CRLF, as Windows does by default, is read
        // by the same lines and answers no `\r` (P199).
        const lines = readFileSync(path, 'utf8').split(/\r?\n/);
        const start = Math.max((node.line ?? 1) - 1, 0);
        const window = sourceWindow(lines, start, {
          ...(input.fromLine === undefined ? {} : { fromLine: input.fromLine }),
          maxLines: input.maxLines,
          context: input.context,
        });
        const past = window.from > window.end;
        // A class read from its start answers its skeleton, unless asked whole (P382): members, bodies folded.
        const skeleton = CLASS_TYPES.has(node.type) && input.whole !== true && input.fromLine === undefined && !past;
        if (skeleton) {
          return withNext(
            {
              id: node.id,
              file: node.file,
              line: start + 1,
              endLine: window.end + 1,
              code: classSkeleton(lines, start, window.end),
              skeleton: true,
              ...requestsOf(db, node),
            },
            [`get_source({symbol: ${JSON.stringify(node.id)}, whole: true})`, ...nextFor(node).filter((hint) => !hint.startsWith('get_source'))].slice(0, MAX_NEXT),
          );
        }

        // At most MAX_CODE_CHARS of code (P396): a window cut there goes on from the next line, as a long one does.
        const to = past ? window.to : lastWithinChars(lines, window.from, window.to);
        const cut = to < window.to;
        const continues = window.continues || cut;
        return withNext(
          {
            id: node.id,
            file: node.file,
            line: window.from + 1,
            endLine: past ? window.end + 1 : to + 1,
            code: lines.slice(window.from, to + 1).join('\n'),
            ...(continues
              ? {
                  truncated: cut
                    ? `cut at ${MAX_CODE_CHARS} characters: declaration continues past line ${to + 1}, to line ${window.end + 1}; ask with fromLine ${to + 2}`
                    : `declaration continues past line ${to + 1}; ask with fromLine ${to + 2}`,
                }
              : {}),
            ...(past ? { note: `the declaration ends at line ${window.end + 1}` } : {}),
            // Where the requests it sends land (P377), so the address need not be rebuilt from the code.
            ...requestsOf(db, node),
          },
          [
            ...(continues ? [`get_source({symbol: ${JSON.stringify(node.id)}, fromLine: ${to + 2}})`] : []),
            ...nextFor(node).filter((hint) => !hint.startsWith('get_source')),
          ].slice(0, MAX_NEXT),
        );
      }),
  );
};
