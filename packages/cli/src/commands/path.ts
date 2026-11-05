import type { GraphEdge } from '@flowatlas/core';
import { findPath, type FlowNode } from '@flowatlas/mcp';
import type { Command } from 'commander';
import { openDbFromOptions, sourceRootsFor } from '../db.js';
import { EXIT, type ExitCode } from '../exit.js';
import { FLOW_FORMATS, withQueryOptions, type QueryOptions } from '../options.js';
import { present, processIo, settingsFor, type QueryIo } from '../query/answer.js';
import { resolveSymbol } from '../query/refs.js';
import { SEQUENCE_WALK_DETAIL, sitesFrom, stopsIn } from '../query/sequence.js';
import { sequenceDetailOf } from './flow.js';
import { askedCommand } from '../query/asked.js';

export interface PathOptions extends QueryOptions {
  undirected?: boolean;
  sequenceDetail?: string;
}

/** What a run of `path` decided, for the command to exit with. */
export interface PathRun {
  /** `found` answers 0; `none` answers 1, as a question whose answer is no. */
  state: 'found' | 'none';
  exitCode: ExitCode;
}

/** A name for the shell, quoted only when it has to be. */
const said = (id: string): string => (/^[\w:./@#-]+$/.test(id) ? id : JSON.stringify(id));

/**
 * How one node reaches another (P229).
 *
 * Directed by default: along the edges `flow` walks, the way the calls run, so
 * the answer is how a request gets from `from` to `to`. `--undirected` asks
 * whether they are joined at all. Without `--depth` the search looks 6 steps,
 * then 12, then 24, as the page's path finder does - it is the same search,
 * core's `shortestWays`. Every node on a shortest path is printed once, as a
 * tree from `from`, up to `--max-nodes`; past that one whole path first.
 *
 * No path within what was searched exits 1, and says how far it looked and
 * how many nodes it reached; and when `to` reaches `from` instead, it says so
 * and how, since asking the wrong way round is the common mistake. Names
 * resolve as every command and tool resolves them; a name that means several
 * nodes, or none, stops with the candidates or the nearest names (exit 1).
 */
const answerPath = (fromRef: string, toRef: string, options: PathOptions, io: QueryIo = processIo): PathRun => {
  const settings = settingsFor(options, io, FLOW_FORMATS);
  const db = openDbFromOptions(settings);
  // Closed when the answer is out (P199): on Windows an open database can
  // be neither replaced by the next build nor removed with its directory.
  try {
    const from = resolveSymbol(db, fromRef, settings.service);
    const to = resolveSymbol(db, toRef, settings.service);
    const sequence = settings.format === 'sequence';
    const edgesOf = sequence ? new Map<FlowNode, GraphEdge>() : undefined;
    const directed = options.undirected !== true;

    const path = findPath(db, from.id, to.id, {
      directed,
      ...(options.depth === undefined ? {} : { depth: settings.depth }),
      maxNodes: settings.maxNodes,
      detail: sequence ? SEQUENCE_WALK_DETAIL : settings.detail,
      ...(edgesOf === undefined ? {} : { edgesOf }),
    });

    const footer = path.found
      ? [
          `${path.paths} shortest ${path.paths === 1 ? 'path' : 'paths'} of ${path.length} ${path.length === 1 ? 'step' : 'steps'}${directed ? '' : ', either way along the edges'}`,
          `unresolved on this path: ${path.unresolvedOnPath}`,
        ]
      : [
          `no path from ${from.id} to ${to.id} within ${path.depth} steps${directed ? '' : ' either way'}; searched ${path.searched} nodes`,
          ...(path.reverse === undefined
            ? []
            : [`${to.id} reaches ${from.id} instead, in ${path.reverse.length} steps: flowatlas path ${said(to.id)} ${said(from.id)}`]),
        ];
    present(
      db,
      settings,
      {
        tree: path.root,
        footer,
        extra: {
          state: path.found ? 'found' : 'none',
          from: from.id,
          to: to.id,
          directed,
          length: path.length,
          paths: path.paths,
          searched: path.searched,
          depth: path.depth,
          unresolvedOnPath: path.unresolvedOnPath,
          ...(path.reverse === undefined ? {} : { reverse: path.reverse }),
        },
        ...(path.left === 0 ? {} : { truncated: `${path.left} more nodes on a shortest path (raise --max-nodes)` }),
        ...(edgesOf === undefined ? {} : { siteOf: sitesFrom(edgesOf), stopOf: stopsIn(db), sequenceDetail: sequenceDetailOf(options.sequenceDetail) }),
      },
      io,
      settings.detail >= 3 ? sourceRootsFor(settings) : undefined,
    );
    return path.found ? { state: 'found', exitCode: EXIT.ok } : { state: 'none', exitCode: EXIT.failed };
  } finally {
    db.close();
  }
};

/** path, logged when the question log is on (P235). */
export const runPath = (fromRef: string, toRef: string, options: PathOptions, io: QueryIo = processIo): PathRun =>
  askedCommand('path', { symbol: fromRef, to: toRef, service: options.service }, options, () => answerPath(fromRef, toRef, options, io));

export const registerPath = (program: Command): void => {
  withQueryOptions(
    program
      .command('path')
      .argument('<from>', 'where the path starts: any node id, "POST /orders", or a unique Class.method')
      .argument('<to>', 'where it ends, named the same ways')
      .description('how one node reaches another, by the shortest ways'),
    { formats: FLOW_FORMATS },
  )
    .option('--undirected', 'walk an edge either way: are these joined at all')
    .option('--sequence-detail <level>', 'with --format sequence, one participant per service or per class')
    .action((from: string, to: string, options: PathOptions) => {
      const run = runPath(from, to, options);
      if (run.exitCode !== EXIT.ok) process.exitCode = run.exitCode;
    });
};
