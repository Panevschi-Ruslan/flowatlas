/**
 * `flowatlas spec` — an OpenAPI 3.1 document of each service's routes and an
 * AsyncAPI 3.0 document of each service's channels, from what the graph
 * already read (P118); and `flowatlas spec diff <base> [head]`, the change
 * between two revisions' documents sorted into breaking-change kinds, each
 * with the callers in the project it breaks.
 *
 * The documents go to the output directory, never into a repository: a
 * repository that commits its document runs `spec --check` in CI, which fails
 * when the committed file is not what would be written now.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { loadConfig, serviceDirOf, toPosixPath, type LoadedConfig } from '@flowatlas/core';
import {
  DEFAULT_SPEC_DEPTH,
  diffSpecs,
  parseSpecDiff,
  routeInventory,
  SPEC_DIFF_FILE,
  SPEC_FAIL_LEVELS,
  SPEC_WANTED,
  specFailures,
  specOptionsOf,
  verifyWritten,
  writeSpecs,
  type InventoryRow,
  type SpecDiffReport,
  type SpecFailLevel,
  type WrittenSpec,
} from '@flowatlas/linker';
import type { Command } from 'commander';
import { openProjectDb } from '../analysis/open.js';
import { cannotRun, CliError, EXIT } from '../exit.js';
import { processIo, type QueryIo } from '../query/answer.js';
import {
  renderInventoryJson,
  renderInventoryMarkdown,
  renderSpecDiffMarkdown,
  renderSpecDiffText,
  renderSpecFile,
  SPEC_FORMATS,
  specFileName,
  summariseSpecDiff,
  type SpecFormat,
} from '../report/spec.js';
import { specsOfGraph } from '../report/spec-delta.js';
import { deliverSarif, sarifBound, sarifLevelFlag, sarifPathsOf, specFindings, toSarif, withSarifOptions } from '../sarif/index.js';
import { VERSION } from '../version.js';
import { buildSides, collect, oneOf, sharedBuild, whole } from './diff.js';
import { runSpecAgainst, SPEC_AGAINST_FORMATS, type SpecAgainstOptions } from './spec-against.js';

/** Where the documents go under the output directory when `--out` is not given. */
export const SPEC_DIR = 'spec';

/** The inventory's file, beside the documents. */
export const inventoryFileName = (format: SpecFormat): string => (format === 'json' ? 'inventory.json' : 'inventory.md');

export interface SpecCommandOptions {
  config?: string;
  db?: string;
  service?: string[];
  kind?: string;
  out?: string;
  format?: string;
  depth?: string;
  /** Exit 1 when a file in `--out` differs from what would be written now; write nothing. */
  check?: boolean;
  /** Also write the inventory of every route. */
  inventory?: boolean;
  /** Commander sets this to false for `--no-verify`. */
  verify?: boolean;
}

export interface SpecFile {
  file: string;
  /** What `--check` found: the same, different, or not there. */
  state?: 'same' | 'differs' | 'missing' | 'stale';
}

export interface SpecRun {
  specs: WrittenSpec[];
  inventory?: InventoryRow[];
  files: SpecFile[];
  /** Differences between what was written and what reads back: bugs, said as such (D3). */
  problems: string[];
  text: string;
  exitCode: number;
}

/** The services asked for, or every one; an unknown name is refused with the known ones. */
export const wanted = (loaded: LoadedConfig, names: readonly string[] | undefined): string[] => {
  const known = loaded.config.services.map((service) => service.name);
  if (names === undefined || names.length === 0) return known;
  const unknown = names.filter((name) => !known.includes(name));
  if (unknown.length > 0) {
    throw cannotRun(`no service named ${unknown.map((name) => JSON.stringify(name)).join(', ')}`, [`Known services: ${[...known].sort().join(', ')}.`]);
  }
  return [...names];
};

/**
 * The output directory, refused when it is inside a repository the
 * configuration reads and something would be written there (P78). `--check`
 * writes nothing, so it may read the document a repository commits.
 */
const outDirOf = (loaded: LoadedConfig, out: string | undefined, writing: boolean): string => {
  const dir = out === undefined ? join(loaded.outputDir, SPEC_DIR) : isAbsolute(out) ? out : resolve(process.cwd(), out);
  if (!writing) return dir;
  for (const service of loaded.config.services) {
    if (service.document !== undefined) continue;
    const repo = serviceDirOf(loaded.rootDir, service.repo);
    if (dir === repo || dir.startsWith(`${repo}${sep}`)) {
      throw new CliError(
        `--out ${out ?? dir} is inside the repository of ${service.name}; documents are written to the output directory, not into a repository it reads`,
        EXIT.cannotRun,
        ['Leave --out out to write them under the configured output, and copy a document into a repository yourself if it commits one; --check may read it there.'],
      );
    }
  }
  return dir;
};

const countsSaid = (counts: Record<string, number>): string =>
  Object.entries(counts)
    .map(([reason, n]) => `${reason} ${n}`)
    .join(', ');

/** A file as a person reads it: from the configuration's directory when it is under it. */
const shownPath = (rootDir: string, file: string): string => {
  const path = relative(rootDir, file);
  // With `/` on every OS, as every other path the run prints (P199); a file on
  // another drive has no relative path and keeps its own.
  return path.startsWith('..') || isAbsolute(path) ? file : toPosixPath(path);
};

/** One line per document: what it holds, what was left out and what was not read. */
const summaryLines = (specs: readonly WrittenSpec[], files: readonly SpecFile[], outDir: string, rootDir: string): string[] => {
  const shown = (file: string): string => shownPath(rootDir, file);
  return specs.map((spec, at) => {
    const file = files[at];
    const omitted = Object.keys(spec.omitted).length === 0 ? '' : ` · left out: ${countsSaid(spec.omitted)}`;
    const unread = Object.keys(spec.unread).length === 0 ? '' : ` · not read: ${countsSaid(spec.unread)}`;
    const state = file?.state === undefined || file.state === 'same' ? '' : ` (${file.state})`;
    return `${spec.kind} ${spec.name}: ${spec.operations.length} operation${spec.operations.length === 1 ? '' : 's'}${omitted}${unread} -> ${shown(file?.file ?? join(outDir, specFileName(spec, 'yaml')))}${state}`;
  });
};

/**
 * Writes the documents, or with `--check` compares them with what is there.
 * Every document is read back by its format's reader first (D3); a document
 * that does not read back into the routes and channel ends it was written
 * from is a bug in flowatlas, and the run says so and exits 2.
 */
export const runSpec = (options: SpecCommandOptions, io: QueryIo = processIo): SpecRun => {
  const kind = oneOf(options.kind, SPEC_WANTED, 'both', '--kind');
  const format = oneOf(options.format, SPEC_FORMATS, 'yaml', '--format');
  const depth = whole(options.depth, DEFAULT_SPEC_DEPTH, '--depth');
  const loaded = loadConfig(options.config ?? process.cwd());
  const services = wanted(loaded, options.service);
  const outDir = outDirOf(loaded, options.out, options.check !== true);

  const { db, close } = openProjectDb({ ...(options.config === undefined ? {} : { config: options.config }), ...(options.db === undefined ? {} : { db: options.db }) });
  let specs: WrittenSpec[];
  let inventory: InventoryRow[] | undefined;
  try {
    const writerOptions = specOptionsOf(loaded.config, { depth });
    specs = writeSpecs(db, services, { ...writerOptions, kind });
    if (options.inventory === true) inventory = routeInventory(db, services, writerOptions);
  } finally {
    close();
  }

  const problems = options.verify === false ? [] : specs.flatMap(verifyWritten);
  const contents: Array<{ file: string; text: string }> = specs.map((spec) => ({ file: join(outDir, specFileName(spec, format)), text: renderSpecFile(spec, format) }));
  if (inventory !== undefined) {
    const file = join(outDir, inventoryFileName(format));
    contents.push({ file, text: format === 'json' ? renderInventoryJson(inventory) : renderInventoryMarkdown(inventory, { file }) });
  }

  let files: SpecFile[];
  if (options.check === true) {
    files = contents.map(({ file, text }) => ({
      file,
      state: !existsSync(file) ? 'missing' : readFileSync(file, 'utf8') === text ? 'same' : 'differs',
    }));
    // A document of the same kind the run would not write any more: a route
    // document for a service that lost its last route is out of date too.
    const writing = new Set(contents.map(({ file }) => file));
    const names = new Set(services);
    if (existsSync(outDir)) {
      for (const name of readdirSync(outDir).sort()) {
        const match = /^(.+?)(?:@[^.]+)?\.(openapi|asyncapi)\.(yaml|json)$/.exec(name);
        if (match === null || match[3] !== format || !names.has(match[1] as string)) continue;
        if (kind !== 'both' && match[2] !== kind) continue;
        const file = join(outDir, name);
        if (!writing.has(file)) files.push({ file, state: 'stale' });
      }
    }
  } else {
    mkdirSync(outDir, { recursive: true });
    for (const { file, text } of contents) writeFileSync(file, text, 'utf8');
    files = contents.map(({ file }) => ({ file }));
  }

  const out = summaryLines(specs, files, outDir, loaded.rootDir);
  if (inventory !== undefined) {
    const file = files[specs.length];
    out.push(`inventory: ${inventory.length} row${inventory.length === 1 ? '' : 's'} -> ${shownPath(loaded.rootDir, file?.file ?? '')}${file?.state === undefined || file.state === 'same' ? '' : ` (${file.state})`}`);
  }
  for (const file of files.slice(contents.length)) out.push(`${shownPath(loaded.rootDir, file.file)} (stale: no longer written)`);
  if (specs.length === 0) out.push(`no document to write: ${services.join(', ')} ${services.length === 1 ? 'has' : 'have'} no route and no channel end`);
  const text = `${out.join('\n')}\n`;
  io.out(text);
  for (const problem of problems) io.err(`flowatlas bug: ${problem}\n`);

  const outOfDate = files.filter((file) => file.state !== undefined && file.state !== 'same');
  if (problems.length > 0) return { specs, ...(inventory === undefined ? {} : { inventory }), files, problems, text, exitCode: EXIT.cannotRun };
  return { specs, ...(inventory === undefined ? {} : { inventory }), files, problems, text, exitCode: outOfDate.length > 0 ? EXIT.failed : EXIT.ok };
};

export const SPEC_DIFF_FORMATS = ['text', 'markdown', 'json', 'sarif'] as const;

export interface SpecDiffOptions {
  config?: string;
  service?: string[];
  format?: string;
  failOn?: string;
  output?: string;
  sarifRoot?: string;
  sarifLevel?: string;
  maxRows?: string;
  depth?: string;
  /** Commander sets this to false for `--no-cache`. */
  cache?: boolean;
  keepWorktrees?: boolean;
  concurrency?: string;
  /** Where `spec-diff.json` goes. Defaults to the configured output. */
  out?: string;
}

export interface SpecDiffRun {
  report: SpecDiffReport;
  text: string;
  file: string;
  exitCode: number;
  /** Services neither ref could be read for. */
  unread?: string[];
}

/**
 * Builds both sides through the cache `diff` uses, writes both sides'
 * documents in memory, compares them, and draws the change. The complete
 * report is written before anything is printed or any exit code decided.
 */
export const runSpecDiff = async (baseRef: string, headRef: string | undefined, options: SpecDiffOptions, io: QueryIo = processIo): Promise<SpecDiffRun> => {
  const format = oneOf(options.format, SPEC_DIFF_FORMATS, 'text', '--format');
  const failOn = oneOf(options.failOn, SPEC_FAIL_LEVELS, 'error', '--fail-on') as SpecFailLevel;
  const maxRows = whole(options.maxRows, 50, '--max-rows');
  const depth = whole(options.depth, DEFAULT_SPEC_DEPTH, '--depth');
  const sarifLevel = sarifLevelFlag(options.sarifLevel);
  const loaded = loadConfig(options.config ?? process.cwd());
  const services = wanted(loaded, options.service);
  const head = headRef ?? null;
  const outputDir = options.out === undefined ? loaded.outputDir : resolve(options.out);
  mkdirSync(outputDir, { recursive: true });
  const workDir = mkdtempSync(join(tmpdir(), 'flowatlas-spec-diff-'));
  try {
    const built = await buildSides(loaded, baseRef, head, services, sharedBuild(workDir, outputDir, options));
    const report = diffSpecs(
      specsOfGraph(loaded, built.base.graph, { services, depth }),
      specsOfGraph(loaded, built.head.graph, { services, depth }),
      { depth },
    );
    parseSpecDiff(report);
    const file = join(outputDir, SPEC_DIFF_FILE);
    writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    const refs = { base: baseRef, head };
    const target = options.output === undefined ? undefined : isAbsolute(options.output) ? options.output : resolve(options.output);
    let text: string;
    if (format === 'sarif') {
      text = deliverSarif(
        toSarif({
          command: 'spec-diff',
          version: VERSION,
          findings: specFindings(report.changes),
          paths: sarifPathsOf({ config: loaded.configPath }, options.sarifRoot),
          maxResults: sarifBound(undefined),
          ...(sarifLevel === undefined ? {} : { minLevel: sarifLevel }),
          completeFile: file,
        }),
        options.output === undefined ? {} : { output: options.output },
        io,
      );
    } else {
      text =
        format === 'json'
          ? `${JSON.stringify(report, null, 2)}\n`
          : format === 'markdown'
            ? renderSpecDiffMarkdown(report, refs, { maxRows, file })
            : renderSpecDiffText(report, refs, { maxRows, file });
      io.out(text);
      if (target !== undefined) writeFileSync(target, text, 'utf8');
    }
    io.err(`spec diff: ${summariseSpecDiff(report)} · ${file}\n`);

    const unread = new Set(
      [...built.head.warnings, ...built.base.warnings]
        .filter((warning) => warning.reason === 'not-a-git-repo' || warning.reason === 'ref-not-found')
        .map((warning) => warning.service ?? '')
        .filter((name) => name !== ''),
    );
    const failing = specFailures(report, failOn).length > 0 || (failOn !== 'none' && unread.size > 0);
    return { report, text, file, exitCode: failing ? EXIT.failed : EXIT.ok, ...(unread.size === 0 ? {} : { unread: [...unread] }) };
  } finally {
    if (options.keepWorktrees === true) io.err(`work kept: ${workDir}\n`);
    else rmSync(workDir, { recursive: true, force: true });
  }
};

export const registerSpec = (program: Command): void => {
  const spec = program
    .command('spec')
    .description('OpenAPI and AsyncAPI documents of each service, written from the graph')
    .option('--config <path>', 'configuration file (default: found from the working directory)')
    .option('--db <path>', 'graph database (default: the configured output)')
    .option('--service <name>', 'only this service, repeatable', collect, [])
    .option('--kind <kind>', `one of ${SPEC_WANTED.join(', ')} (default both: only what each service has)`)
    .option('--out <dir>', `where to write (default: <output>/${SPEC_DIR}/; never inside a repository)`)
    .option('--format <name>', `one of ${SPEC_FORMATS.join(', ')}; with --against, one of ${SPEC_AGAINST_FORMATS.join(', ')}`)
    .option('--depth <n>', `named types followed into a shape before it is cut (default ${DEFAULT_SPEC_DEPTH})`)
    .option('--check', 'write nothing; exit 1 when a file there differs from what would be written now')
    .option('--inventory', 'also write one table of every route: guarded, public, callers, tables, channels, fails')
    .option('--no-verify', 'do not read each document back through its reader')
    .option('--against <service=file>', 'compare a committed OpenAPI or AsyncAPI document with the code, repeatable; <service> alone for its configured apiDocuments', collect, [])
    .option('--fail-on <level>', `with --against: ${SPEC_FAIL_LEVELS.join(', ')} (default error)`)
    .option('--max-rows <n>', 'with --against: most changes printed (the file is complete)')
    .option('--output <file>', 'with --against: write what was printed to this file as well; with --format sarif, the log goes there instead of stdout');
  withSarifOptions(spec, { output: false }).action((options: SpecCommandOptions & SpecAgainstOptions) => {
      if ((options.against ?? []).length > 0) {
        const run = runSpecAgainst(options);
        if (run.exitCode !== EXIT.ok) {
          const { errors, warnings } = run.report.summary;
          throw new CliError(`the code does not keep ${errors} promise${errors === 1 ? '' : 's'} its document makes${options.failOn === 'warning' ? `, and ${warnings} to check` : ''}`, EXIT.failed);
        }
        return;
      }
      const { exitCode, problems } = runSpec(options);
      if (exitCode === EXIT.cannotRun) throw new CliError(`${problems.length} document(s) did not read back into what they were written from; this is a bug in flowatlas`, EXIT.cannotRun);
      if (exitCode !== EXIT.ok) throw new CliError('a document there is not what would be written now', EXIT.failed);
    });

  const diff = spec
    .command('diff')
    .description('what an API change breaks, sorted by kind, with the callers each breaks')
    .argument('<base-ref>', 'the ref to compare against, e.g. main')
    .argument('[head-ref]', 'the ref to compare (default: the working tree)')
    .option('--config <path>', 'configuration file (default: found from the working directory)')
    .option('--service <name>', 'compare only this service, repeatable', collect, [])
    .option('--format <name>', `one of ${SPEC_DIFF_FORMATS.join(', ')}`)
    .option('--fail-on <level>', `${SPEC_FAIL_LEVELS.join(', ')} (default error)`)
    .option('--output <file>', 'write what was printed to this file as well; with --format sarif, the log goes there instead of stdout')
    .option('--max-rows <n>', 'most changes printed (the file is complete)')
    .option('--depth <n>', `named types followed into a shape (default ${DEFAULT_SPEC_DEPTH})`)
    .option('--concurrency <n>', 'how many repositories to read at once')
    .option('--out <dir>', `where to write ${SPEC_DIFF_FILE} (default: the configured output)`)
    .option('--no-cache', 'read every commit again rather than believing the cache')
    .option('--keep-worktrees', 'leave the detached checkouts on disk, for debugging');
  withSarifOptions(diff, { output: false }).action(async (baseRef: string, headRef: string | undefined, options: SpecDiffOptions) => {
    const { exitCode, unread, report } = await runSpecDiff(baseRef, headRef, options);
    if (exitCode !== EXIT.ok) {
      throw new CliError(
        unread === undefined
          ? `this revision makes ${report.summary.errors} breaking API change${report.summary.errors === 1 ? '' : 's'}${options.failOn === 'warning' ? ` and ${report.summary.warnings} to check` : ''}`
          : `${unread.join(', ')} could not be read at either ref, so this comparison does not cover ${unread.length === 1 ? 'it' : 'them'}`,
        EXIT.failed,
      );
    }
  });
};

