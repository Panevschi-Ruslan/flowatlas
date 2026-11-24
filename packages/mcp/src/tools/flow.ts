import type { DetailLevel, GraphNode } from '@flowatlas/core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { projectDetail } from '../query/detail.js';
import { isResolved, resolveSymbol } from '../query/entry-ref.js';
import { findPath, type PathResult } from '../query/path.js';
import { withDocs } from '../query/docs.js';
import { buildFlowTree, type FlowResult } from '../query/flow.js';
import { endLineReader, markEndLines } from '../query/end-lines.js';
import { failuresSeenRef, markFailsSeen } from '../query/fails.js';
import { failuresSeen, figuresOf, loadObservedCounts, markObserved, nodeAmbiguous, nodeRow, sampledIn } from '../query/observed.js';
import type { FlowNode } from '../query/types.js';
import { nearNames } from './entries.js';
import { MAX_NEXT, withNext, withTraceFor } from '../query/next.js';
import { slimTree, type WireFlowNode, type WireNode } from '../query/wire.js';
import { bound, callOf, commonInput, completeOf, READ_ONLY, withDb, type ToolContext } from './common.js';
import { trafficDiffers } from './contract.js';

/**
 * `next` with `check_contract({edge: entry})` second (P113), when traffic
 * into the entry carried bodies that differ from what its code declares.
 */
const withDrift = (next: readonly string[], entry: string, differs: boolean): string[] =>
  !differs ? [...next] : [...next.slice(0, 1), callOf('check_contract', { edge: entry }), ...next.slice(1)].slice(0, MAX_NEXT);
import { rulesReportOf, violatedHops } from './rules.js';

/** Marks each step whose hop in a violation of an architecture rule runs along (P114). */
const markViolations = (root: FlowNode, hops: ReadonlyMap<string, string[]>): void => {
  if (hops.size === 0) return;
  const visit = (row: FlowNode): void => {
    for (const child of row.children) {
      const rules = hops.get(`${row.node.id}|${child.node.id}`) ?? hops.get(`${child.node.id}|${row.node.id}`);
      if (rules !== undefined && child.node.ref !== true) child.violates = rules;
      visit(child);
    }
  };
  visit(root);
};

/**
 * What a reader keeps on a node for itself (P382): how it found the node
 * (`adapter`, `source`, `receiver`), the class or package it came through
 * (`controller`, `package`), the path as written before parameters were
 * named alike (`rawPath`), the entity a query reads (`entityType`, said by
 * the row's type). None answers a question about the flow, and at detail 2
 * every step paid for them.
 */
export const READER_META: ReadonlySet<string> = new Set(['adapter', 'controller', 'rawPath', 'source', 'package', 'receiver', 'entityType']);

/** Whether an edge's types are the ones the step's signature already says, in order. */
const sameTypes = (params: readonly unknown[] | undefined, signature: { params?: Array<{ type?: unknown }> } | undefined): boolean =>
  params !== undefined &&
  signature?.params !== undefined &&
  params.length === signature.params.length &&
  params.every((type, index) => type === signature.params?.[index]?.type);

/**
 * A detail-2 tree with each fact said once (P382): an edge's `params` and
 * `returns` left out where the step it leads to says them in its signature,
 * and the reader's own meta (`READER_META`) left out of every step: five
 * trees came out 14% smaller, with nothing a question asks gone.
 */
export const withoutRepeats = (row: WireFlowNode): WireFlowNode => {
  const node = row.node as WireNode & { meta?: Record<string, unknown> };
  // The row's own `fails` and `guards` say what the meta's `fails` and `access.guards` do, in the walk's words.
  const access = node.meta?.['access'] as Record<string, unknown> | undefined;
  const said = (key: string): boolean =>
    READER_META.has(key) ||
    (key === 'fails' && row.fails !== undefined) ||
    (key === 'access' && row.guards !== undefined && access !== undefined && Object.keys(access).every((part) => part === 'guards'));
  const meta = node.meta === undefined ? undefined : Object.fromEntries(Object.entries(node.meta).filter(([key]) => !said(key)));
  const signature = meta?.['signature'] as { params?: Array<{ type?: unknown }>; returns?: unknown } | undefined;
  const edge = row.edge === undefined ? undefined : { ...row.edge };
  if (edge !== undefined && sameTypes(edge.params, signature)) delete edge.params;
  if (edge !== undefined && edge.returns !== undefined && edge.returns === signature?.returns) delete edge.returns;
  const { meta: _meta, ...rest } = node;
  return {
    ...row,
    node: (meta === undefined ? rest : Object.keys(meta).length === 0 ? rest : { ...rest, meta }) as WireNode,
    ...(edge === undefined ? {} : { edge }),
    children: row.children.map(withoutRepeats),
  };
};

/** The tree as it goes out: slimmed, and at detail 2 each fact said once. */
const treeOut = (root: FlowNode, detail: number): WireFlowNode => (detail >= 2 ? withoutRepeats(slimTree(root)) : slimTree(root));

/**
 * What `get_flow` shows when nobody says (P92 D4): a tree, not a list, so fewer
 * rows than a list tool's 150, and about as many characters as an assistant
 * reads in one go. Whichever comes first stops the walk.
 */
export const FLOW_DEFAULTS = { maxNodes: 60, maxChars: 12000 } as const;

/** The first row reached across an HTTP call, breadth first, with the row it hangs under. */
const firstHttpCrossing = (root: FlowNode): { from: string; to: string } | undefined => {
  const queue: Array<{ row: FlowNode; parent: string }> = root.children.map((row) => ({ row, parent: root.node.id }));
  while (queue.length > 0) {
    const { row, parent } = queue.shift()!;
    if (row.edge?.type === 'http_calls' && row.node.ref !== true) return { from: parent, to: row.node.id };
    queue.push(...row.children.map((child) => ({ row: child, parent: row.node.id })));
  }
  return undefined;
};

/**
 * The calls worth making next (P92): the prompt, whether the first HTTP
 * crossing still agrees on its shapes, the first crossing the walk did not
 * follow, the blast radius, and the source of the first step.
 */
const flowNext = (id: string, flow: FlowResult): string[] => {
  const http = firstHttpCrossing(flow.root);
  const left = flow.crossingsLeft?.[0];
  const first = flow.root.children[0];
  return [
    `describe_for_prompt({id: ${JSON.stringify(id)}})`,
    ...(http === undefined ? [] : [callOf('check_contract', http)]),
    ...(left === undefined ? [] : [callOf('get_flow', { entry: left.to })]),
    `impact({symbol: ${JSON.stringify(id)}})`,
    ...(first === undefined ? [] : [`get_source({symbol: ${JSON.stringify(first.node.id)}})`]),
  ].slice(0, MAX_NEXT);
};

/** The deepest a path search looks when it widens by itself: the last of `PATH_DEPTHS`. */
const WIDEST_PATH = 24;

/**
 * `get_flow` with `to` (P229): the flow cut down to the shortest ways that
 * reach `to`, from the entry or from any node, in the tree `get_flow` answers
 * with. No path is said with how far was looked and how much was searched, and
 * with the other way round when that holds, so the next call is the right one.
 */
const pathAnswer = (fromId: string, toId: string, path: PathResult, depth: number | undefined, detail: number) => {
  const asked = depth === undefined ? {} : { depth };
  const next = path.found
    ? [callOf('describe_for_prompt', { id: toId }), callOf('impact', { symbol: toId }), callOf('get_flow', { entry: fromId })]
    : path.reverse !== undefined
      ? [callOf('get_flow', { entry: toId, to: fromId, ...asked })]
      : path.depth < WIDEST_PATH
        ? [callOf('get_flow', { entry: fromId, to: toId, depth: WIDEST_PATH })]
        : [callOf('get_flow', { entry: fromId }), callOf('impact', { symbol: toId })];
  return withNext(
    {
      root: treeOut(path.root, detail),
      to: toId,
      pathsFound: path.paths,
      length: path.length,
      searched: path.searched,
      depth: path.depth,
      unresolvedOnPath: path.unresolvedOnPath,
      ...(path.left === 0 ? {} : { truncated: `${path.left} more nodes on a shortest path (raise maxNodes)`, stoppedBy: ['maxNodes'] }),
      ...(path.found ? {} : { none: `no path within ${path.depth} steps; searched ${path.searched} nodes` }),
      ...(path.reverse === undefined ? {} : { reverse: { ...path.reverse, note: `${toId} reaches ${fromId} instead` } }),
    },
    next,
  );
};

/** One end of a path that named several nodes or none: the candidates, each as the call that takes it. */
const endUnresolved = (
  end: { candidates: GraphNode[] },
  key: 'entry' | 'to',
  said: string,
  keep: Record<string, string>,
  detail: DetailLevel,
) =>
  end.candidates.length > 0
    ? withNext(
        { [key]: said, candidates: end.candidates.map((node) => projectDetail(node, detail)) },
        end.candidates.slice(0, MAX_NEXT).map((node) => callOf('get_flow', { ...keep, [key]: node.id })),
      )
    : { error: `nothing matches ${JSON.stringify(said)}`, [key]: said };

export const registerFlow = (server: McpServer, ctx: ToolContext): void => {
  server.registerTool(
    'get_flow',
    {
      title: 'Trace an entry point',
      description:
        'One entry followed across repositories, as a call-order tree with guards; with `to`, the shortest ways there. `stoppedBy` says what cut it and `crossingsLeft` the crossings to ask on.',
      inputSchema: {
        entry: z.string().describe('"POST /orders", an id or a name'),
        to: z.string().optional(),
        depth: z.number().int().min(1).max(32).optional().describe('hops; default 8, +1 per workflow step'),
        detail: commonInput.detail,
        maxNodes: z.number().int().min(1).max(2000).default(FLOW_DEFAULTS.maxNodes),
        maxChars: z.number().int().min(1000).max(200000).default(FLOW_DEFAULTS.maxChars),
      },
      annotations: READ_ONLY,
    },
    (input) =>
      withDb(ctx.handle, (db) => {
        const { detail, maxNodes, note } = bound(input);
        if (input.to !== undefined) {
          // A path may start anywhere, so both ends resolve as any tool resolves a name.
          const from = resolveSymbol(db, input.entry);
          const to = resolveSymbol(db, input.to);
          if (!isResolved(from)) return endUnresolved(from, 'entry', input.entry, { to: input.to }, detail);
          if (!isResolved(to)) return endUnresolved(to, 'to', input.to, { entry: input.entry }, detail);
          const path = findPath(db, from.id, to.id, {
            ...(input.depth === undefined ? {} : { depth: input.depth }),
            maxNodes,
            detail,
          });
          return { ...pathAnswer(from.id, to.id, path, input.depth, detail), ...(note === undefined ? {} : { note }) };
        }
        // Any symbol, the way who_calls and find_symbol take one (P377): an entry said aloud first,
        // then a class, a method or a function by its id, `Class.method` or a short name that is
        // the only best match; a name several nodes share answers the candidates.
        const ref = resolveSymbol(db, input.entry);

        if (!isResolved(ref)) {
          if (ref.candidates.length > 0) {
            return withNext(
              { candidates: ref.candidates.map((node) => projectDetail(node, detail)) },
              ref.candidates.slice(0, MAX_NEXT).map((node) => `get_flow({entry: ${JSON.stringify(node.id)}})`),
            );
          }
          // Near names of any node, entries first, so a misspelt route still finds its route.
          const near = [...nearNames(db.nodesByType('entry'), input.entry, 5), ...nearNames(db.allNodes(), input.entry, 5)]
            .filter((node, index, all) => all.findIndex((other) => other.id === node.id) === index)
            .slice(0, 5);
          return withNext(
            {
              error: `nothing matches ${JSON.stringify(input.entry)}`,
              ...(near.length === 0 ? {} : { suggestions: near.map((node) => projectDetail(node, detail)) }),
            },
            near.length > 0
              ? near.slice(0, MAX_NEXT).map((node) => `get_flow({entry: ${JSON.stringify(node.id)}})`)
              : // A path is looked for among the routes, by any parameter name (P377); a name among every node.
                input.entry.includes('/')
                ? [callOf('search', { query: input.entry, kinds: ['routes'] })]
                : [callOf('find_symbol', { query: input.entry })],
          );
        }

        const flow = buildFlowTree(db, ref.id, {
          ...(input.depth === undefined ? {} : { depth: input.depth }),
          maxNodes,
          maxChars: input.maxChars,
          detail,
        });
        markViolations(flow.root, violatedHops(rulesReportOf(db, ctx)));
        // Where each step's code ends, so a Read goes straight to it (P393).
        markEndLines(flow.root, (id) => db.node(id), endLineReader(ctx.handle));
        const counts = loadObservedCounts(ctx.handle.path);
        if (counts !== undefined) {
          const seen = nodeRow(counts, ref.id);
          if (seen !== undefined) Object.assign(flow.root, { observed: seen.hits, ...figuresOf(seen) });
          const unsure = nodeAmbiguous(counts, ref.id);
          if (unsure !== undefined) flow.root.seenAmbiguous = unsure;
          markObserved(counts, ref.id, flow.root.children, 'forward');
          // What the way in answered against what it declares (P106).
          const compared = failuresSeen(counts, ref.node);
          if (compared !== undefined) {
            markFailsSeen(flow.root.fails, { count: compared.hits, ...(seen?.statuses === undefined ? {} : { statuses: seen.statuses }) });
            flow.root.failures = failuresSeenRef(compared);
          }
        }
        return withNext(
          {
            root: treeOut(flow.root, detail),
            // The less specific routes that answer the same request (P94 D2).
            ...(ref.alsoAnswers === undefined ? {} : { alsoAnswers: ref.alsoAnswers }),
            // A channel written with placeholders: the one it denotes (P360).
            ...(ref.channelUsed === undefined ? {} : { channelUsed: ref.channelUsed }),
            unresolvedOnPath: flow.unresolvedOnPath,
            ...(flow.truncated === undefined ? {} : { truncated: flow.truncated, stoppedBy: flow.stoppedBy }),
            ...(flow.crossingsLeft === undefined ? {} : { crossingsLeft: flow.crossingsLeft }),
            // The pages that describe this flow (P120): a change here is one they must follow.
            ...withDocs(db, ctx.handle.path, ref.id),
            // The whole flow, or what was cut or left unread on it (P364).
            ...completeOf([
              flow.truncated !== undefined && `${(flow.stoppedBy ?? []).join(', ') || 'cut'}: ${flow.truncated}`,
              flow.unresolvedOnPath > 0 &&
                `unread: ${flow.unresolvedOnPath} step${flow.unresolvedOnPath === 1 ? '' : 's'} on the path could not be followed`,
            ]),
            ...(note === undefined ? {} : { note }),
          },
          withDrift(
            withTraceFor(flowNext(ref.id, flow), ref.node, sampledIn(ctx.handle.path)),
            ref.id,
            ref.node?.type === 'entry' && trafficDiffers(ctx, ref.id),
          ),
        );
      }),
  );
};
