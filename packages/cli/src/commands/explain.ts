import { describeAnswer, PROMPT_LIMITS, PROMPT_SCOPES, type PromptScopeName } from '@flowatlas/mcp';
import type { Command } from 'commander';
import { handleFor, type DbOptions } from '../db.js';
import { cannotRun, notFound } from '../exit.js';
import { processIo, type QueryIo } from '../query/answer.js';

/** What `explain` writes: the Markdown itself, or the answer the graph server's tool returns. */
export const EXPLAIN_FORMATS = ['markdown', 'json'] as const;

export interface ExplainOptions extends DbOptions {
  scope?: string;
  maxSteps?: string;
  maxChars?: string;
  format?: string;
  withSpec?: boolean;
}

const whole = (value: string | undefined, fallback: number, flag: string, least: number, most: number): number => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < least || parsed > most) {
    throw cannotRun(`${flag} must be a whole number from ${least} to ${most}, not ${JSON.stringify(value)}`);
  }
  return parsed;
};

const scopeOf = (value: string | undefined): PromptScopeName | undefined => {
  if (value === undefined) return undefined;
  const found = PROMPT_SCOPES.find((scope) => scope === value);
  if (found === undefined) throw cannotRun(`--scope must be one of ${PROMPT_SCOPES.join(', ')}, not ${JSON.stringify(value)}`);
  return found;
};

const formatOf = (value: string | undefined): (typeof EXPLAIN_FORMATS)[number] => {
  if (value === undefined) return 'markdown';
  const found = EXPLAIN_FORMATS.find((format) => format === value);
  if (found === undefined) throw cannotRun(`--format must be one of ${EXPLAIN_FORMATS.join(', ')}, not ${JSON.stringify(value)}`);
  return found;
};

/** A candidate as the answer lists it: its id, and where it is when the graph knows. */
const candidateLine = (candidate: unknown): string => {
  if (typeof candidate === 'string') return `  ${candidate}`;
  const node = candidate as { id: string; loc?: string; service?: string };
  const where = node.loc === undefined ? '' : `  ${node.service === undefined ? '' : `${node.service}/`}${node.loc}`;
  return `  ${node.id}${where}`;
};

/**
 * Everything the graph knows about one name, as the graph server's
 * `describe_for_prompt` writes it (P229).
 *
 * The text is the tool's, character for character, and the page's *Copy as
 * prompt*: one renderer for every surface (P97), so the terminal never says
 * something an assistant is told differently. Markdown by default, in a pipe
 * too, since it is read or handed on as it is; `--format json` is the tool's
 * whole answer, `next` included.
 */
export const runExplain = (name: string, options: ExplainOptions, io: QueryIo = processIo): void => {
  const format = formatOf(options.format);
  const scope = scopeOf(options.scope);
  const input = {
    id: name,
    ...(scope === undefined ? {} : { scope }),
    maxSteps: whole(options.maxSteps, PROMPT_LIMITS.maxSteps, '--max-steps', 1, 200),
    maxChars: whole(options.maxChars, PROMPT_LIMITS.maxChars, '--max-chars', 500, 40000),
    ...(options.withSpec === true ? { withSpec: true } : {}),
  };
  const handle = handleFor(options);
  const opened = handle.open();
  if ('error' in opened) throw cannotRun(opened.error);
  // Closed when the answer is out (P199): on Windows an open database can
  // be neither replaced by the next build nor removed with its directory.
  try {
    const answer = describeAnswer(opened.db, { handle }, input) as {
      markdown?: string;
      candidates?: unknown[];
      error?: string;
      scopes?: string[];
    };
    if (answer.candidates !== undefined) {
      throw notFound(`${JSON.stringify(name)} matches ${answer.candidates.length} things`, [
        ...answer.candidates.map(candidateLine),
        'pass one of these ids',
      ]);
    }
    if (answer.error !== undefined) {
      // A scope the node does not have is a flag that makes no sense for it; a name nothing has is an answer.
      if (answer.scopes !== undefined) throw cannotRun(answer.error, [`scopes it has: ${answer.scopes.join(', ')}`]);
      throw notFound(answer.error);
    }
    io.out(format === 'json' ? `${JSON.stringify(answer, null, 2)}\n` : `${(answer.markdown ?? '').trimEnd()}\n`);
  } finally {
    opened.db.close();
  }
};

export const registerExplain = (program: Command): void => {
  program
    .command('explain')
    .argument('<name>', 'any id, gap id, file:line, channel, "POST /orders", or a class, file or service with --scope')
    .description('everything the graph knows about one name, as the graph server describes it')
    .option('--db <path>', 'database to read (default: the configured one)')
    .option('--config <path>', 'configuration file (default: found from the working directory)')
    .option('--scope <scope>', `what to describe: ${PROMPT_SCOPES.join(', ')}`)
    .option('--max-steps <n>', `most chain steps written (default ${PROMPT_LIMITS.maxSteps})`)
    .option('--max-chars <n>', `most characters written (default ${PROMPT_LIMITS.maxChars})`)
    .option('--with-spec', "add the route's or channel's part of the written API document")
    .option('--format <name>', `one of ${EXPLAIN_FORMATS.join(', ')}`)
    .action((name: string, options: ExplainOptions) => {
      runExplain(name, options);
    });
};
