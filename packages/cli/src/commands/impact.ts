import type { DetailLevel, GraphNode } from '@flowatlas/core';
import type { Command } from 'commander';
import { compactAnswer, impactOf, projectDetail, projectEdge, staleFor, type FlowNode, type ImpactOf, type ThroughChannel } from '@flowatlas/mcp';
import { handleFor, sourceRootsFor } from '../db.js';
import { cannotRun } from '../exit.js';
import { withQueryOptions, type QueryOptions } from '../options.js';
import { present, processIo, settingsFor, staleLine, type QueryIo } from '../query/answer.js';
import { reachableSummary } from '../query/callers.js';
import { resolveSymbol } from '../query/refs.js';
import { askedCommand, noteAnswer } from '../query/asked.js';

export interface ImpactOptions extends QueryOptions {
  entriesOnly?: boolean;
  /** The row of the answer to start at, as the tool's `offset` (P370). */
  offset?: string;
  /** With `--format json`: the tool's answer whole, as `verbose: true` asks it (P370). */
  verbose?: boolean;
  /** A channel the answer says ways in lie beyond: list those instead, as the tool's `channel` (P372). */
  channel?: string;
}

/** A row of impact's answer as the footer reads it: the fields the tool says beside each way in. */
interface AnswerRow {
  id: string;
  label?: string;
  service?: string;
  reach?: string;
  via?: string;
  from?: string;
  gap?: string;
  behind?: string;
}

/** One row of the footer: the way in, its service, whether it runs, and the crossing it came through. */
const rowLine = (row: AnswerRow): string => {
  const name = `${row.label ?? row.id}${row.service === undefined || row.service === '' ? '' : ` (${row.service})`}`;
  const said = [
    row.reach,
    row.via === undefined ? undefined : `via ${row.via}`,
    row.gap === undefined ? undefined : `gap ${row.gap}`,
    row.behind === undefined ? undefined : `behind ${row.behind}`,
  ].filter((part): part is string => part !== undefined);
  return `  ${name}${said.length === 0 ? '' : `  ${said.join(', ')}`}`;
};

/** How many ways in a channel the walk did not cross leads to, the nearest few named, and the consumer taking its messages (P372). */
const throughLine = (through: ThroughChannel): string => {
  const named = through.ways.slice(0, 3).map((way) => `${way.node.label}${way.node.repo === '' ? '' : ` (${way.node.repo})`}`);
  const more = through.ways.length > named.length ? ', ...' : '';
  const count = `${through.cut ? 'at least ' : ''}${through.ways.length} way${through.ways.length === 1 ? '' : 's'} in`;
  return `  ${through.channel}${through.type === undefined ? '' : ` ${through.type}`}  ${count}, taken by ${through.consumer.label} (${through.consumer.repo}): ${named.join(', ')}${more}`;
};

/**
 * The lines under the tree: the ways in grouped as the report words them,
 * then each row of the answer with whether it runs and the crossing it came
 * through, the maybe rows apart, and what the answer says it left (P370).
 */
const footerOf = (of: ImpactOf): string[] => {
  const answer = of.answer as {
    entries?: AnswerRow[];
    entriesNone?: string;
    left?: string[];
    unreached?: number;
    acrossChannel?: string;
  };
  const unreached = answer.unreached ?? 0;
  const rows = answer.entries ?? [];
  const maybeIds = new Set((of.maybes ?? []).map((way) => way.node.id));
  const ways = rows.filter((row) => !maybeIds.has(row.id));
  const maybes = rows.filter((row) => maybeIds.has(row.id));
  return [
    reachableSummary(
      (of.ways ?? []).map((way) => way.node),
      of.servicesWithoutEntry ?? [],
    ),
    ...(ways.length === 0 ? [] : [answer.acrossChannel === undefined ? 'Could break:' : `Beyond channel ${answer.acrossChannel}, calling none of it:`, ...ways.map(rowLine)]),
    ...(maybes.length === 0 ? [] : ['Maybe, behind a call the reading could not follow:', ...maybes.map(rowLine)]),
    ...(unreached === 0
      ? []
      : [`Unreached: ${unreached} chain${unreached === 1 ? ' ends' : 's end'} at code whose name its repository writes nowhere else, so nothing could break through ${unreached === 1 ? 'it' : 'them'}`]),
    ...(answer.acrossChannel !== undefined || (of.throughChannels ?? []).length === 0
      ? []
      : ['Only beyond a channel, calling none of it (--channel <name> lists them):', ...(of.throughChannels ?? []).map(throughLine)]),
    ...(answer.entriesNone === undefined ? [] : [answer.entriesNone]),
    ...(answer.left ?? []).map((left) => `Left: ${left}`),
  ];
};

/**
 * The walk drawn as a tree (P370): the target at the root and, under it, the
 * chain back to each row of the answer, the same walk the tool reads its rows
 * from (`waysIn`). A node on several chains is drawn once, where the walk met
 * it first; `--depth` draws the chains that many hops back, the rows past it
 * still listed under the tree.
 */
const treeOf = (of: ImpactOf, detail: DetailLevel, depth: number | undefined, entriesOnly: boolean): { root: FlowNode; cut: number } => {
  const target = of.target as GraphNode;
  const root: FlowNode = { node: projectDetail(target, detail), children: [] };
  const listed = of.listed ?? [];
  if (entriesOnly) {
    root.children = listed.map((way) => ({ node: projectDetail(way.node, detail), children: [] }));
    return { root, cut: 0 };
  }
  const walked = of.walked;
  if (walked === undefined) return { root, cut: 0 };
  const starts = new Set((of.starts ?? []).map((start) => start.id));
  // Every node on a chain from a listed row back to a start.
  const drawn = new Set<string>();
  for (const way of listed) {
    for (let at: string | undefined = way.node.id; at !== undefined && !starts.has(at) && !drawn.has(at); at = walked.parents.get(at)?.from) {
      drawn.add(at);
    }
  }
  const flows = new Map<string, { flow: FlowNode; depth: number }>([[target.id, { flow: root, depth: 0 }]]);
  // The methods a class answers for hang under it, the class being the root.
  for (const start of of.starts ?? []) {
    if (start.id === target.id) continue;
    const flow: FlowNode = { node: projectDetail(start, detail), children: [] };
    root.children.push(flow);
    flows.set(start.id, { flow, depth: 1 });
  }
  let cut = 0;
  // Breadth first, as the walk met them, so a parent is placed before its children.
  for (const node of walked.met) {
    if (!drawn.has(node.id)) continue;
    const step = walked.parents.get(node.id);
    const parent = step === undefined ? undefined : flows.get(step.from);
    if (parent === undefined) continue;
    if (depth !== undefined && parent.depth + 1 > depth) {
      cut += 1;
      continue;
    }
    const flow: FlowNode = {
      node: projectDetail(node, detail),
      ...(step?.edge === undefined ? {} : { edge: projectEdge(step.edge, detail) }),
      children: [],
    };
    parent.flow.children.push(flow);
    flows.set(node.id, { flow, depth: parent.depth + 1 });
  }
  return { root, cut };
};

const whole = (value: string | undefined, flag: string): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw cannotRun(`${flag} must be a whole number of at least 0, not ${JSON.stringify(value)}`);
  return parsed;
};

/**
 * Every way in that could break if a symbol changes, and what lies between.
 *
 * The answer is the graph server's `impact` (P370): one walk back past every
 * way in to the callers beyond it, each row with whether it runs and the
 * crossing it came through, and the chains an unread call stops as maybe
 * rows. `--format json` prints that answer, compact as the tool hands it, or
 * whole with `--verbose`; the tree draws the walk's chain to each row, with
 * the rows under it.
 */
const answerImpact = (symbol: string, options: ImpactOptions, io: QueryIo): void => {
  const settings = settingsFor(options, io);
  const handle = handleFor(settings);
  const opened = handle.open();
  if ('error' in opened) throw cannotRun(opened.error);
  const db = opened.db;
  // Closed when the answer is out (P199): on Windows an open database can
  // be neither replaced by the next build nor removed with its directory.
  try {
    const target = resolveSymbol(db, symbol, settings.service);
    const offset = whole(options.offset, '--offset');
    const of = impactOf(db, handle, {
      symbol: target.id,
      ...(settings.service === undefined ? {} : { service: settings.service }),
      detail: settings.detail,
      maxNodes: settings.maxNodes,
      ...(offset === undefined ? {} : { offset }),
      ...(options.channel === undefined ? {} : { channel: options.channel }),
    });

    if (settings.format === 'json') {
      // What an agent is handed, compact as the tool's (P365); `--verbose` prints it whole.
      const stale = staleFor(handle.path, of.answer);
      if (stale !== undefined) io.err(`${staleLine(stale)}\n`);
      const said = stale === undefined ? of.answer : { ...of.answer, stale };
      const text = `${options.verbose === true ? JSON.stringify(said, null, 2) : JSON.stringify(compactAnswer(said))}\n`;
      io.out(text);
      noteAnswer(said, text.length);
      return;
    }

    const { root, cut } = treeOf(of, settings.detail, options.depth === undefined ? undefined : settings.depth, options.entriesOnly === true);
    present(
      db,
      settings,
      {
        tree: root,
        footer: footerOf(of),
        ...(cut === 0 ? {} : { truncated: `${cut} more nodes past depth ${settings.depth}` }),
      },
      io,
      settings.detail >= 3 ? sourceRootsFor(settings) : undefined,
    );
  } finally {
    db.close();
  }
};

/** impact, logged when the question log is on (P235). */
export const runImpact = (symbol: string, options: ImpactOptions, io: QueryIo = processIo): void =>
  askedCommand('impact', { symbol, service: options.service }, options, () => answerImpact(symbol, options, io));

export const registerImpact = (program: Command): void => {
  withQueryOptions(
    program
      .command('impact')
      .argument('<symbol>', 'a node id, or a unique Class.method')
      .description('every way in that could break if a symbol changes, in any service, and what lies between'),
  )
    .option('--entries-only', 'list the ways in under the target instead of the chains to them')
    .option('--offset <n>', 'the row to start the list at, as the answer\'s nextOffset says')
    .option('--verbose', 'with --format json, the whole answer, pretty-printed, instead of the compact one')
    .option('--channel <name>', 'list the ways in beyond a channel the answer counts under throughChannels')
    .action((symbol: string, options: ImpactOptions) => {
      runImpact(symbol, options);
    });
};
