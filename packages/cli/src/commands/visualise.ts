import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import { cannotRun } from '../exit.js';
import { openDbFromOptions, type DbOptions } from '../db.js';
import { packGraph } from '../visualise/pack.js';
import { shipped } from '../own-path.js';

/** The template ships beside the code, whether that is source or build output. */
const template = (): string => {
  const path = shipped(
    import.meta.url,
    'visualise/page.html',
    '../visualise/page.html',
    '../../src/visualise/page.html',
  );
  try {
    return readFileSync(path, 'utf8');
  } catch {
    throw cannotRun('the page template is missing; rebuild the command');
  }
};

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

export interface VisualiseOptions extends DbOptions {
  out?: string;
  title?: string;
  print?: (message: string) => void;
}

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
    });
  } finally {
    db.close();
  }

  const title = options.title ?? nameFrom(options.config ?? options.db ?? process.cwd());
  const page = template()
    .replace(/__TITLE__/g, title)
    .replace('__DATA__', embeddable(packed));

  const path = resolve(options.out ?? 'graph.html');
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
    .option('--out <file>', 'where to write it (default: beside the graph, as graph.html)')
    .option('--title <name>', 'what to call the project on the page')
    .action((options: VisualiseOptions) => {
      runVisualise(options);
    });
};
