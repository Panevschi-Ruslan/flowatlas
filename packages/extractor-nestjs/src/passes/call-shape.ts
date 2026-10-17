import { join } from 'node:path';
import {
  callShapeOf,
  callsOnLine,
  siteNodeAt,
  SITE_LEAF_TYPES,
  type CallShape,
  type GraphBuilder,
  type GraphEdge,
} from '@flowatlas/core';
import type { Project, SourceFile } from 'ts-morph';
import type { NestExtractContext } from '../context.js';
import { definePass } from './types.js';

/**
 * Calls in a loop, and calls side by side (P69).
 *
 * Every call edge is looked up at its site. One inside a loop gets
 * `meta.inLoop: { kind, line }`; one inside the arguments of `Promise.all`,
 * `allSettled`, `race` or `any` gets `meta.concurrent: true` and
 * `meta.together: { by, line }`, which is what the Steps view draws side by
 * side. A query, cache call, HTTP call or publish run once per item - directly,
 * or through a function the loop calls - is also a `query-in-loop` row: the
 * likely N+1.
 */

/** What a leaf does, in the words a row about running it per item uses. */
const LEAF_WORDS: ReadonlyMap<string, string> = new Map([
  ['db_query', 'database query'],
  ['cache_op', 'cache call'],
  ['http_out', 'HTTP call'],
  ['producer', 'publish'],
  ['ui_api_call', 'API call'],
]);

const SITE_LEAVES: ReadonlySet<string> = new Set(SITE_LEAF_TYPES);

/** `<type>:<repo>#<file>:<line>:<col>` read back, for a leaf of a kind this pass reads. */
const leafSite = (id: string): { type: string; file: string; line: number; column: number } | undefined => {
  const match = /^([a-z_]+):[^#]*#(.+):(\d+):(\d+)$/.exec(id);
  if (match === null) return undefined;
  const [, type, file, line, column] = match;
  if (type === undefined || file === undefined || !SITE_LEAVES.has(type)) return undefined;
  return { type, file, line: Number(line), column: Number(column) };
};

/** The name a call to a function or method node is made by: what follows its last `.` or `:`. */
const calleeName = (id: string): string | undefined => {
  const tail = id.slice(id.lastIndexOf('#') + 1);
  const name = tail.slice(Math.max(tail.lastIndexOf('.'), tail.lastIndexOf(':')) + 1);
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : undefined;
};

/** Sources by repository-relative path, each opened once. */
const sourcesOf = (project: Project, repoDir: string): ((file: string) => SourceFile | undefined) => {
  const opened = new Map<string, SourceFile | undefined>();
  return (file) => {
    if (!opened.has(file)) opened.set(file, project.getSourceFile(join(repoDir, file)));
    return opened.get(file);
  };
};

/** What every call on a line agrees on; a disagreement says nothing. */
const agreed = (shapes: readonly CallShape[]): CallShape => {
  const [first] = shapes;
  if (first === undefined) return {};
  const shape: CallShape = {};
  if (first.loop !== undefined && shapes.every((s) => s.loop !== undefined)) shape.loop = first.loop;
  if (first.concurrent !== undefined && shapes.every((s) => s.concurrent !== undefined)) {
    shape.concurrent = first.concurrent;
  }
  return shape;
};

const shapeOfEdge = (edge: GraphEdge, open: (file: string) => SourceFile | undefined): CallShape => {
  const leaf = leafSite(edge.to);
  if (leaf !== undefined) {
    const source = open(leaf.file);
    const node = source === undefined ? undefined : siteNodeAt(source, leaf.line, leaf.column);
    return node === undefined ? {} : callShapeOf(node);
  }
  if (edge.file === undefined || edge.line === undefined) return {};
  const name = calleeName(edge.to);
  const source = open(edge.file);
  if (name === undefined || source === undefined) return {};
  return agreed(callsOnLine(source, edge.line, name).map(callShapeOf));
};

const mark = (edge: GraphEdge, shape: CallShape): void => {
  if (shape.loop === undefined && shape.concurrent === undefined) return;
  edge.meta = {
    ...edge.meta,
    ...(shape.loop === undefined ? {} : { inLoop: { ...shape.loop } }),
    ...(shape.concurrent === undefined ? {} : { concurrent: true, together: { ...shape.concurrent } }),
  };
};

/** The first leaf worth a row that a node reaches through calls, nearest first. */
const leafReached = (from: string, callsFrom: ReadonlyMap<string, readonly string[]>): string | undefined => {
  const seen = new Set([from]);
  const queue = [from];
  for (let i = 0; i < queue.length; i += 1) {
    for (const to of callsFrom.get(queue[i] ?? '') ?? []) {
      const leaf = leafSite(to);
      if (leaf !== undefined && LEAF_WORDS.has(leaf.type)) return to;
      if (seen.has(to)) continue;
      seen.add(to);
      queue.push(to);
    }
  }
  return undefined;
};

/**
 * `leafReached`, asked once per node: every edge in a loop into one method -
 * a save or a lookup called from many loops - reaches the same leaf, and the
 * search it costs grows with the graph (P79).
 */
const leavesReached = (callsFrom: ReadonlyMap<string, readonly string[]>): ((from: string) => string | undefined) => {
  const known = new Map<string, string | undefined>();
  return (from) => {
    if (!known.has(from)) known.set(from, leafReached(from, callsFrom));
    return known.get(from);
  };
};

const report = (builder: GraphBuilder, edge: GraphEdge, reached: (from: string) => string | undefined): void => {
  const loop = edge.meta?.['inLoop'] as { kind: string; line: number } | undefined;
  if (loop === undefined || edge.file === undefined || edge.line === undefined) return;
  const direct = leafSite(edge.to);
  const reaches = direct === undefined ? reached(edge.to) : edge.to;
  const leaf = reaches === undefined ? undefined : leafSite(reaches);
  const words = leaf === undefined ? undefined : LEAF_WORDS.get(leaf.type);
  if (reaches === undefined || words === undefined) return;
  builder.addUnresolved({
    file: edge.file,
    line: edge.line,
    reason: 'query-in-loop',
    // Likely, not certain: a list known to stay small costs nothing. A finding
    // (row-kind.ts, P81), so it is counted under findings and never as a miss,
    // and `nothing` keeps meaning a place with no edge to draw.
    level: 'info',
    sites: 1,
    message:
      direct === undefined
        ? `A call made once per item of a \`${loop.kind}\` loop reaches a ${words}: likely N+1.`
        : `A ${words} runs once per item of a \`${loop.kind}\` loop: likely N+1.`,
    hint: 'Read every item in one call - a list of ids, a batch, a join - before the loop, and look each one up in memory.',
    symbol: edge.from,
    meta: {
      loop: { ...loop },
      reaches,
      ...(direct === undefined ? { via: edge.to } : {}),
      ...(edge.meta?.['concurrent'] === true ? { concurrent: true } : {}),
    },
  });
};

export const callShapePass = definePass('call-shape', (ctx: NestExtractContext) => {
  const open = sourcesOf(ctx.project, ctx.repoDir);
  const calls = ctx.builder.edges.filter((edge) => edge.type === 'calls');
  const callsFrom = new Map<string, string[]>();
  for (const edge of calls) {
    const list = callsFrom.get(edge.from);
    if (list === undefined) callsFrom.set(edge.from, [edge.to]);
    else list.push(edge.to);
  }
  for (const edge of calls) mark(edge, shapeOfEdge(edge, open));
  const reached = leavesReached(callsFrom);
  for (const edge of calls) report(ctx.builder, edge, reached);
});
