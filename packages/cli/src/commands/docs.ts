/**
 * `flowatlas docs [paths...]` — Markdown kept true to the graph (P120).
 *
 * A page names a flow, a channel or a symbol in a block; this reads every
 * block, says whether what it shows is still what the graph says, and with
 * `--write` regenerates the content between its markers. With `--check` a
 * pipeline fails when a page describes a flow that has since changed, so "the
 * architecture page is out of date" is a red check rather than a feeling.
 *
 * The only command that writes inside a repository, and only on `--write`,
 * only between flowatlas markers, only in the files named or configured
 * (D1). Every run writes `docs.json` beside the graph, so the MCP server and
 * the page know which documents describe what.
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { expandGlob, isGlob, NOTES_META } from '@flowatlas/core';
import {
  DOC_STATES,
  DOCS_FORMAT_VERSION,
  docsIndexSchema,
  blockRegion,
  parseDocs,
  rewriteDocBlocks,
  type DocBlock,
  type DocRewrite,
  type DocsEntry,
  type DocsIndex,
  type DocState,
  type GraphDb,
  mentionsOf,
  type DocsMention,
  type DocsDeadMention,
} from '@flowatlas/linker';
import { checkDocBlock, DbHandle, docsPathFor, resolveMention, type DocCheck } from '@flowatlas/mcp';
import { OVERVIEW_SECTIONS, overviewFingerprint, overviewOf, type OverviewSection } from '../overview/overview.js';
import { renderOverview } from '../overview/render.js';
import type { Command } from 'commander';
import { cannotRun, CliError, EXIT, type ExitCode } from '../exit.js';
import { processIo, type QueryIo } from '../query/answer.js';
import { renderDocView, sayChange } from '../docs/views.js';

export const DOCS_FORMATS = ['text', 'json', 'github'] as const;
export type DocsFormat = (typeof DOCS_FORMATS)[number];

/** Every Markdown file under the configuration, when neither the command line nor `docs.files` says which. */
export const DEFAULT_DOC_GLOB = '**/*.md';

export interface DocsOptions {
  config?: string;
  db?: string;
  /** Exit 1 on a block that no longer says what the graph says, 2 on a marker that cannot be read. */
  check?: boolean;
  /** Regenerate the content of every block that resolves, in place. */
  write?: boolean;
  /** Every block with its id, view and state. */
  list?: boolean;
  /**
   * The pages that name a node in code (P234): with `--list` every mention,
   * with `--check` also exit 1 on one that names something the graph does not
   * hold any more.
   */
  mentions?: boolean;
  format?: string;
  /** Where relative paths on the command line are read from; the working directory unless a test says. */
  cwd?: string;
}

/** One block, read and checked. */
export interface DocResult {
  /** Relative to the configuration's directory, `/`-separated. */
  file: string;
  block: DocBlock;
  check: DocCheck;
  /** Set when `--write` rewrote it. */
  written?: true;
  /** For a tour: notes whose step is gone, kept at the end of the block. */
  orphaned?: string[];
}

export interface DocsProblem {
  file: string;
  line: number;
  message: string;
}

export interface DocsRun {
  index: DocsIndex;
  results: DocResult[];
  problems: DocsProblem[];
  /** Files `--write` changed, relative like `file`. */
  written: string[];
  text: string;
  exitCode: ExitCode;
  /** Where `docs.json` was written. */
  indexPath: string;
}

const oneOf = <T extends string>(value: string | undefined, allowed: readonly T[], fallback: T, flag: string): T => {
  if (value === undefined) return fallback;
  const found = allowed.find((candidate) => candidate === value);
  if (found === undefined) throw cannotRun(`${flag} must be one of ${allowed.join(', ')}, not ${JSON.stringify(value)}`);
  return found;
};

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/** Whether a path is inside a directory (or is it). */
const within = (path: string, dir: string): boolean => {
  const rel = relative(dir, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

/**
 * The Markdown files a run reads: the paths or globs named (a directory is
 * every `*.md` under it), else `docs.files`, else every `*.md` under the
 * configuration. Never a file in the output directory or `node_modules`.
 */
export const docFiles = (
  named: readonly string[],
  where: { cwd: string; rootDir: string; outputDir: string; configured?: readonly string[] },
): { files: string[]; missing: string[] } => {
  const missing: string[] = [];
  const found = new Set<string>();
  const take = (base: string, pattern: string, named: boolean): void => {
    const absolute = isAbsolute(pattern) ? pattern : resolve(base, pattern);
    const glob = isGlob(pattern) ? pattern : isDirectory(absolute) ? `${pattern.replace(/[\\/]+$/, '')}/${DEFAULT_DOC_GLOB}` : undefined;
    if (glob === undefined) {
      if (isFile(absolute)) found.add(absolute);
      else if (named) missing.push(pattern);
      return;
    }
    for (const path of expandGlob(base, glob)) found.add(path);
  };
  if (named.length > 0) for (const pattern of named) take(where.cwd, pattern, true);
  else if (where.configured !== undefined && where.configured.length > 0) for (const pattern of where.configured) take(where.rootDir, pattern, true);
  else take(where.rootDir, DEFAULT_DOC_GLOB, false);
  const files = [...found]
    .filter((path) => !within(path, where.outputDir) && !path.split(sep).includes('node_modules'))
    .sort();
  return { files, missing };
};

/** A path as the run names it: relative to the configuration's directory, with `/`. */
const relativeTo = (rootDir: string) => (path: string): string => relative(rootDir, path).split(sep).join('/');

/**
 * The blocks of one Markdown text, each checked against the graph, and, with
 * `write`, the text with every block that resolves regenerated. A block that
 * names nothing or more than one thing is never written (I3).
 */
export const docsIn = (
  db: GraphDb,
  file: string,
  markdown: string,
  options: { write?: boolean; overview?: (block: DocBlock) => string } = {},
): { results: DocResult[]; problems: DocsProblem[]; text: string } => {
  const parsed = parseDocs(markdown);
  const problems = parsed.problems.map((problem) => ({ file, ...problem }));
  // An overview naming a section there is none of is a marker that cannot be read (P228).
  const blocks = parsed.blocks.filter((block) => {
    const wrong = (block.options.sections ?? []).filter((name) => !(OVERVIEW_SECTIONS as readonly string[]).includes(name));
    if (block.kind !== 'overview' || wrong.length === 0) return true;
    problems.push({ file, line: block.line, message: `unknown overview section ${wrong.map((name) => JSON.stringify(name)).join(', ')}; one of ${OVERVIEW_SECTIONS.join(', ')}` });
    return false;
  });
  const results: DocResult[] = blocks.map((block) => ({ file, block, check: checkBlock(db, block) }));
  if (options.write !== true) return { results, problems, text: markdown };

  const rewrites = new Map<DocBlock, DocRewrite>();
  for (const result of results) {
    if (result.block.kind === 'overview') {
      if (options.overview === undefined || result.check.fingerprint === undefined) continue;
      rewrites.set(result.block, { content: options.overview(result.block), fingerprint: result.check.fingerprint, steps: [] });
      continue;
    }
    const subject = result.check.subject;
    if (result.block.kind === 'ref' || subject === undefined) continue;
    const drawn = renderDocView(db, result.block, subject);
    rewrites.set(result.block, { content: drawn.content, fingerprint: subject.fingerprint, steps: subject.steps });
    if (drawn.orphaned !== undefined) result.orphaned = drawn.orphaned;
  }
  const text = rewriteDocBlocks(markdown, rewrites);
  for (const result of results) {
    const rewrite = rewrites.get(result.block);
    if (rewrite === undefined) continue;
    // What was rewritten now says what the graph says. A block whose text
    // came out the same was already true and is not counted as written.
    if (blockRegion(markdown, result.block, rewrite) !== markdown.slice(result.block.openEnd, result.block.end)) result.written = true;
    const { changes: _changes, why: _why, ...rest } = result.check;
    result.check = { ...rest, state: 'ok' };
  }
  return { results, problems, text };
};

/**
 * A block checked against a graph: an overview by the project's structure
 * (P228 D2) - its services, what crosses between them, the stores two write,
 * the single threads - and every other kind by the graph server's check.
 */
export const checkBlock = (db: GraphDb, block: DocBlock): DocCheck => {
  if (block.kind !== 'overview') return checkDocBlock(db, block);
  const fingerprint = overviewFingerprint(
    overviewOf(db, undefined, { structureOnly: true, ...(block.options.service === undefined ? {} : { service: block.options.service }) }),
  );
  if (block.fingerprint === fingerprint) return { state: 'ok', fingerprint };
  if (block.fingerprint === undefined) return { state: 'changed', fingerprint, why: 'never written: run flowatlas docs --write' };
  return { state: 'changed', fingerprint, why: 'the project changed shape: a service, what crosses between two, a store two services write, or a single thread' };
};

/** A row of `docs.json`. */
const entryOf = (result: DocResult): DocsEntry => {
  const { block, check } = result;
  const options = block.options;
  return {
    file: result.file,
    line: block.line,
    kind: block.kind,
    id: block.id,
    ...(check.node === undefined ? {} : { node: check.node.id }),
    ...(block.view === undefined ? {} : { view: block.view }),
    ...(Object.keys(options).length === 0 ? {} : { options }),
    state: check.state,
    // What the file holds now: the new fingerprint where it was just written.
    ...(check.state === 'ok' && check.fingerprint !== undefined
      ? { fingerprint: check.fingerprint }
      : block.fingerprint === undefined
        ? {}
        : { fingerprint: block.fingerprint }),
    ...(check.near === undefined ? {} : { near: check.near }),
    ...(check.candidates === undefined ? {} : { candidates: check.candidates }),
  };
};

const countsOf = (results: readonly DocResult[]): Record<DocState, number> => {
  const counts = Object.fromEntries(DOC_STATES.map((state) => [state, 0])) as Record<DocState, number>;
  for (const result of results) counts[result.check.state] += 1;
  return counts;
};

/** What is wrong with a block, one line each, under its own line. */
const detailLines = (result: DocResult): string[] => {
  const { check } = result;
  const lines: string[] = [];
  for (const change of check.changes ?? []) lines.push(sayChange(change, check.subject));
  if (check.why !== undefined) lines.push(check.why);
  if (check.note !== undefined) lines.push(check.note);
  if (check.state === 'gone') lines.push(check.near === undefined || check.near.length === 0 ? 'nothing near that name' : `nearest: ${check.near.join(', ')}`);
  if (check.candidates !== undefined) lines.push(`could mean: ${check.candidates.join(', ')}; add service="…" or use a full id`);
  if (result.orphaned !== undefined) lines.push(`orphaned notes kept at the end of the block: ${result.orphaned.join(', ')}`);
  return lines;
};

const headOf = (result: DocResult): string =>
  `${result.file}:${result.block.line}  ${result.block.kind} ${result.block.id}${result.block.view === undefined ? '' : ` (${result.block.view})`}`;

const summaryOf = (run: Pick<DocsRun, 'results' | 'problems' | 'written' | 'index'>): string => {
  const counts = countsOf(run.results);
  const files = new Set(run.results.map((result) => result.file)).size;
  const said = DOC_STATES.filter((state) => counts[state] > 0).map((state) => `${counts[state]} ${state}`);
  return (
    `docs: ${run.results.length} ${run.results.length === 1 ? 'block' : 'blocks'} in ${files} of ${run.index.files.length} ${run.index.files.length === 1 ? 'file' : 'files'}` +
    (said.length === 0 ? '' : `: ${said.join(', ')}`) +
    (run.problems.length === 0 ? '' : `; ${run.problems.length} ${run.problems.length === 1 ? 'marker' : 'markers'} not read`) +
    (run.written.length === 0 ? '' : `; wrote ${run.written.join(', ')}`)
  );
};

const renderText = (run: Pick<DocsRun, 'results' | 'problems' | 'written' | 'index'>, list: boolean, mentions = false): string => {
  const lines: string[] = [];
  if (list && mentions) {
    for (const mention of run.index.mentions) lines.push(`${mention.file}:${mention.line}  ${mention.kind} \`${mention.text}\` → ${mention.node}${mention.heading === undefined ? '' : `  (under ${mention.heading})`}`);
  }
  if (mentions) {
    for (const dead of run.index.deadMentions) lines.push(`${dead.file}:${dead.line}  names \`${dead.text}\`, which the graph does not hold${dead.near.length === 0 ? '' : `; nearest: ${dead.near.join(', ')}`}`);
  }
  for (const result of run.results) {
    if (list) {
      lines.push(`${headOf(result)}  ${result.check.state}`);
      continue;
    }
    if (result.check.state === 'ok' && result.orphaned === undefined && result.written !== true) continue;
    lines.push(`${headOf(result)}  ${result.check.state}${result.written === true ? ', written' : ''}`);
    for (const line of detailLines(result)) lines.push(`    ${line}`);
  }
  for (const problem of run.problems) lines.push(`${problem.file}:${problem.line}  not read: ${problem.message}`);
  lines.push(summaryOf(run));
  if (run.index.mentions.length > 0 || run.index.deadMentions.length > 0) {
    const dead = run.index.deadMentions.length;
    lines.push(
      `${run.index.mentions.length} mention${run.index.mentions.length === 1 ? '' : 's'} of a node in code${dead === 0 ? '' : `; ${dead} name${dead === 1 ? 's' : ''} something the graph does not hold${mentions ? '' : ' (--mentions lists them)'}`}`,
    );
  }
  return `${lines.join('\n')}\n`;
};

/** `%`, CR and LF as a workflow command spells them, so a message stays one annotation. */
const ghEscape = (text: string): string => text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

const renderGithub = (run: Pick<DocsRun, 'results' | 'problems' | 'written' | 'index'>, mentions = false): string => {
  const lines: string[] = [];
  if (mentions) {
    for (const dead of run.index.deadMentions) {
      lines.push(`::warning file=${dead.file},line=${dead.line},title=flowatlas docs::${ghEscape(`names ${dead.text}, which the graph does not hold${dead.near.length === 0 ? '' : `; nearest: ${dead.near.join(', ')}`}`)}`);
    }
  }
  for (const result of run.results) {
    if (result.check.state === 'ok') continue;
    const detail = detailLines(result);
    lines.push(
      `::warning file=${result.file},line=${result.block.line},title=flowatlas docs::${ghEscape(
        `${result.block.kind} ${result.block.id} is ${result.check.state}${detail.length === 0 ? '' : `: ${detail.join('; ')}`}`,
      )}`,
    );
  }
  for (const problem of run.problems) lines.push(`::error file=${problem.file},line=${problem.line},title=flowatlas docs::${ghEscape(problem.message)}`);
  lines.push(summaryOf(run));
  return `${lines.join('\n')}\n`;
};

const renderJson = (run: Pick<DocsRun, 'results' | 'problems' | 'written' | 'index'>): string =>
  `${JSON.stringify(
    {
      ...run.index,
      blocks: run.index.blocks.map((entry, at) => {
        const result = run.results[at] as DocResult;
        const detail = {
          ...(result.check.changes === undefined ? {} : { changes: result.check.changes.map((change) => sayChange(change, result.check.subject)) }),
          ...(result.check.why === undefined ? {} : { why: result.check.why }),
          ...(result.check.note === undefined ? {} : { note: result.check.note }),
          ...(result.orphaned === undefined ? {} : { orphaned: result.orphaned }),
          ...(result.written === true ? { written: true } : {}),
        };
        return { ...entry, ...detail };
      }),
      counts: countsOf(run.results),
      written: run.written,
    },
    null,
    2,
  )}\n`;

/**
 * Reads, checks and, with `--write`, regenerates every block of the files
 * named or configured, writes `docs.json`, and says what it found.
 */
export const runDocs = (paths: readonly string[], options: DocsOptions, io: QueryIo = processIo): DocsRun => {
  const format = oneOf(options.format, DOCS_FORMATS, 'text', '--format');
  if (options.list === true && options.write === true) throw cannotRun('--list reads and --write writes; ask for one');
  const cwd = options.cwd ?? process.cwd();
  let handle: DbHandle;
  try {
    handle = new DbHandle({
      ...(options.db === undefined ? {} : { dbPath: resolve(cwd, options.db) }),
      ...(options.config === undefined ? (options.db === undefined ? { configPath: cwd } : {}) : { configPath: resolve(cwd, options.config) }),
    });
  } catch (cause) {
    throw cannotRun(cause instanceof Error ? cause.message : String(cause));
  }
  const opened = handle.open();
  if ('error' in opened) throw cannotRun(opened.error);
  const db = opened.db;
  const rootDir = handle.configDir ?? cwd;
  const outputDir = dirname(handle.path);
  const rel = relativeTo(rootDir);

  try {
    const { files, missing } = docFiles(paths, {
      cwd,
      rootDir,
      outputDir,
      ...(handle.config?.docs?.files === undefined ? {} : { configured: handle.config.docs.files }),
    });
    const results: DocResult[] = [];
    const mentions: DocsMention[] = [];
    const deadMentions: DocsDeadMention[] = [];
    const problems: DocsProblem[] = missing.map((file) => ({ file, line: 0, message: 'no such file' }));
    const written: string[] = [];
    for (const path of files) {
      const file = rel(path);
      const markdown = readFileSync(path, 'utf8');
      const read = docsIn(db, file, markdown, {
        write: options.write === true,
        // Drawn with what the tools read beside the graph, two levels down as every block's headings are.
        overview: (block) =>
          renderOverview(overviewOf(db, handle, block.options.service === undefined ? {} : { service: block.options.service }), {
            level: 3,
            ...(block.options.sections === undefined ? {} : { sections: block.options.sections as OverviewSection[] }),
          }),
      });
      results.push(...read.results);
      problems.push(...read.problems);
      // The names it mentions in code (P234), linked where they name exactly one node.
      for (const mention of mentionsOf(markdown)) {
        const found = resolveMention(db, mention.text);
        if (found === undefined) continue;
        if ('node' in found) mentions.push({ file, line: mention.line, text: mention.text, node: found.node.id, kind: 'mention', ...(mention.heading === undefined ? {} : { heading: mention.heading }) });
        else deadMentions.push({ file, line: mention.line, text: mention.text, near: found.near });
      }
      if (read.text !== markdown) {
        writeFileSync(path, read.text, 'utf8');
        written.push(file);
      }
    }

    // A doc comment's `@see page.md` (P234): the node names the page, which is one of these files or is not there.
    const read = new Set(files.map(rel));
    for (const node of db.allNodes()) {
      for (const note of (node.meta?.[NOTES_META] as unknown[] | undefined) ?? []) {
        const see = typeof note === 'string' ? /^SEE:\s*(\S+\.md)\b/.exec(note)?.[1] : undefined;
        if (see === undefined) continue;
        const named = [...read].find((page) => page === see || page.endsWith(`/${see.replace(/^\.?\//, '')}`));
        if (named !== undefined) mentions.push({ file: named, line: 1, text: see, node: node.id, kind: 'see' });
        else deadMentions.push({ file: `${node.repo}/${node.file ?? ''}`, line: node.line ?? 1, text: see, near: [] });
      }
    }
    const index: DocsIndex = docsIndexSchema.parse({
      docsFormatVersion: DOCS_FORMAT_VERSION,
      mentions,
      deadMentions,
      files: files.map(rel),
      blocks: results.map(entryOf),
      problems,
    });
    const indexPath = docsPathFor(handle.path);
    mkdirSync(dirname(indexPath), { recursive: true });
    writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');

    const run = { index, results, problems, written };
    const text =
      format === 'json'
        ? renderJson(run)
        : format === 'github'
          ? renderGithub(run, options.mentions === true)
          : renderText(run, options.list === true, options.mentions === true);
    io.out(text);

    const stale = results.some((result) => result.check.state !== 'ok') || (options.mentions === true && deadMentions.length > 0);
    const exitCode: ExitCode = options.check !== true ? EXIT.ok : problems.length > 0 ? EXIT.cannotRun : stale ? EXIT.failed : EXIT.ok;
    return { ...run, text, exitCode, indexPath };
  } finally {
    handle.close();
  }
};

export const registerDocs = (program: Command): void => {
  program
    .command('docs')
    .description('check, or regenerate, the Markdown blocks that describe a flow, a channel or a symbol')
    .argument('[paths...]', 'Markdown files, directories or globs (default: docs.files, else every *.md under the configuration)')
    .option('--check', 'exit 1 when a block no longer says what the graph says, 2 when a marker cannot be read')
    .option('--write', 'regenerate the content between the markers of every block, in place')
    .option('--list', 'every block with its id, view and state')
    .option('--mentions', 'also the pages that name a node in code: with --list every one, with --check fail on one that names what is gone')
    .option('--format <name>', `one of ${DOCS_FORMATS.join(', ')}`)
    .option('--config <path>', 'configuration file (default: found from the working directory)')
    .option('--db <path>', 'database to read (default: the configured one)')
    .action((paths: string[], options: DocsOptions) => {
      const { exitCode } = runDocs(paths, options);
      if (exitCode !== EXIT.ok) {
        throw new CliError(exitCode === EXIT.failed ? 'some doc blocks no longer say what the graph says' : 'some doc markers could not be read', exitCode);
      }
    });
};
