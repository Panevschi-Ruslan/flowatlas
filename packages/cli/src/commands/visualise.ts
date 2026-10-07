import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { loadConfig } from '@flowatlas/core';
import type { Command } from 'commander';
import { cannotRun } from '../exit.js';
import { openDbFromOptions, sourceRootsFor, type DbOptions } from '../db.js';
import { EDITOR_NAMES } from '../visualise/graph.js';
import { packGraph, type PackInput } from '../visualise/pack.js';
import { shipped } from '../own-path.js';

/** A file the page is made of, beside the code whether that is source or build output. */
const part = (name: string): string => {
  const path = shipped(
    import.meta.url,
    `visualise/${name}`,
    `../visualise/${name}`,
    `../../src/visualise/${name}`,
  );
  try {
    return readFileSync(path, 'utf8');
  } catch {
    throw cannotRun(`the page's ${name} is missing; rebuild the command`);
  }
};

/**
 * The page, with the graph view's logic written into it.
 *
 * The logic is two modules of its own - what to draw, and the frame around it -
 * so that a test can import exactly the text the browser runs; the page holds
 * both inline, in one module script, so the result is still one file with
 * nothing to fetch.
 */
const template = (): string =>
  part('page.html')
    .replace('__GRAPH_LOGIC__', () => part('graph.js'))
    .replace('__FRAME_LOGIC__', () => part('frame.js'));

/**
 * A name for the project, since the configuration does not carry one.
 *
 * The directory holding the configuration is what people call it in
 * conversation, which is a better answer than anything invented here.
 */
const nameFrom = (where: string): string => {
  const path = resolve(where);
  // A configuration is named by the directory holding it; a directory names
  // itself. Taking the parent of either would name the folder they live in,
  // which is somebody's Desktop.
  const folder = basename(path.endsWith('.json') ? dirname(path) : path);
  const spaced = folder.replace(/[-_]+/g, ' ').trim();
  if (spaced === '') return 'Project map';
  const named = `${spaced.charAt(0).toUpperCase()}${spaced.slice(1)}`;
  return /map/i.test(named) ? named : `${named} map`;
};

/**
 * A JSON payload is raw text inside its script block, so only an escape JSON
 * itself understands can survive being read back out.
 */
const embeddable = (data: unknown): string => JSON.stringify(data).replace(/</g, '\\u003c');

/**
 * Where the page goes when nobody says: next to the configuration it was built
 * from, which is the project's own folder, found the same way the database was.
 * Given only a database there is no configuration to stand beside, so the
 * working directory.
 */
const defaultFolder = (options: DbOptions): string => {
  if (options.config === undefined && options.db !== undefined) return process.cwd();
  try {
    return dirname(loadConfig(options.config ?? process.cwd()).configPath);
  } catch {
    return process.cwd();
  }
};

export interface VisualiseOptions extends DbOptions {
  out?: string;
  title?: string;
  /** `vscode`, `cursor`, `idea` or `file`: make every `file:line` a link that opens it. */
  editorLinks?: string;
  print?: (message: string) => void;
}

/**
 * The editor links asked for, with where each service's sources are, or none.
 *
 * Off unless asked: a link to a file is the file's absolute path on this
 * machine, written into a page that is made to be sent to other people. Asked
 * for without a configuration there is no telling where a repository is, and a
 * page of links that open nothing is refused rather than written.
 */
const editorFor = (options: VisualiseOptions): PackInput['editor'] => {
  const name = options.editorLinks;
  if (name === undefined) return undefined;
  if (!EDITOR_NAMES.includes(name)) {
    throw cannotRun(`--editor-links takes one of ${EDITOR_NAMES.join(', ')}; got ${JSON.stringify(name)}`);
  }
  if (options.config === undefined && options.db !== undefined) {
    throw cannotRun('--editor-links needs the configuration, to know where each repository is; pass --config');
  }
  const roots = sourceRootsFor(options);
  return { name, rootOf: (service) => roots.repoDir(service) };
};

export interface VisualiseResult {
  path: string;
  bytes: number;
  nodes: number;
  edges: number;
}

/**
 * Writes the graph as one page anybody can open.
 *
 * Deliberately a file and not a server: it is generated from a build, it is
 * complete on its own, and it can be attached to a review or kept beside a
 * decision. A viewer that has to be running to answer anything is the thing the
 * plan warns against; a page that says what the build found is a report.
 */
export const runVisualise = (options: VisualiseOptions = {}): VisualiseResult => {
  const print = options.print ?? ((message: string) => process.stdout.write(`${message}\n`));
  const editor = editorFor(options);
  const db = openDbFromOptions(options);
  let packed;
  let counts;
  try {
    const report = db.report();
    if (report === undefined) throw cannotRun('the database holds no report; run flowatlas build');
    const nodes = db.allNodes();
    const edges = db.allEdges();
    counts = { nodes: nodes.length, edges: edges.length };
    packed = packGraph({
      builtAt: report.builtAt,
      nodes,
      edges,
      unresolved: db.allUnresolved(),
      report,
      typeOf: (id) => db.type(id),
      ...(editor === undefined ? {} : { editor }),
    });
  } finally {
    db.close();
  }

  const title = options.title ?? nameFrom(options.config ?? options.db ?? process.cwd());
  // Replaced through a function: a replacement string reads `$&` and `$'` as
  // patterns, and a label is free to contain either.
  const page = template()
    .replace(/__TITLE__/g, () => title)
    .replace('__DATA__', () => embeddable(packed));

  const path = resolve(options.out ?? resolve(defaultFolder(options), 'graph.html'));
  writeFileSync(path, page, 'utf8');

  const result = { path, bytes: Buffer.byteLength(page), ...counts };
  print(
    `${result.nodes.toLocaleString()} nodes, ${result.edges.toLocaleString()} edges, ` +
      `${Math.round(result.bytes / 1024)}KB`,
  );
  print(path);
  return result;
};

export const registerVisualise = (program: Command): void => {
  program
    .command('visualise')
    .alias('visualize')
    .description('write the graph as one page you can open in a browser')
    .option('--config <path>', 'configuration file (default: found from the working directory)')
    .option('--db <path>', 'database to read (default: the configured one)')
    .option('--out <file>', 'where to write it (default: graph.html next to the configuration)')
    .option('--title <name>', 'what to call the project on the page')
    .option(
      '--editor-links <editor>',
      `make each file:line a link that opens it: ${EDITOR_NAMES.join(', ')}. Writes absolute local paths into the page`,
    )
    .action((options: VisualiseOptions) => {
      runVisualise(options);
    });
};
