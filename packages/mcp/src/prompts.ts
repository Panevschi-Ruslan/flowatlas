/**
 * The reviews an assistant is asked for most, as MCP prompts (P96).
 *
 * A rename, a pull request and a route each take the same chain of calls
 * every time, and the chain was a recipe the assistant had to know. A prompt
 * is that recipe written out with the ids already resolved: text that names
 * the calls, never a call the server makes and never an answer pasted in (D3),
 * since an answer is stale the moment the graph is rebuilt. Every call is
 * written by the same functions `next` writes with (`hintsFor`, `callOf`), so
 * a prompt and an answer can never disagree about a tool's name or argument.
 */
import type { GraphEdge, GraphNode } from '@flowatlas/core';
import type { GraphDb } from '@flowatlas/linker';
import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { projectDetail } from './query/detail.js';
import { isResolved, resolveEntryRef, resolveSymbol } from './query/entry-ref.js';
import { buildFlowTree } from './query/flow.js';
import { nearNames } from './query/names.js';
import { hintsFor } from './query/next.js';
import type { FlowNode } from './query/types.js';
import { diffState, readDiff, sideLabel } from './tools/changes.js';
import { callOf, type ToolContext } from './tools/common.js';
import { FLOW_DEFAULTS } from './tools/flow.js';
import { usesOfType } from './tools/type-usage.js';
import { resolveTypeRef } from './tools/types.js';

/** The prompts this server offers, by name. */
export const PROMPT_NAMES = ['before-rename', 'pr-review', 'trace-route'] as const;
export type PromptName = (typeof PROMPT_NAMES)[number];

/** Most `check_contract` calls one prompt names; the rest are counted. */
export const MAX_CROSSING_CHECKS = 6;

/** Most candidates a prompt lists when a name answers to several. */
const MAX_CANDIDATES = 8;

/** The edges a crossing between services is made of, and the ones `check_contract` judges. */
const CROSSING_TYPES: readonly string[] = ['http_calls', 'hits', 'emits', 'consumes'];
const CHECKED_TYPES: readonly string[] = ['http_calls', 'hits', 'emits'];

/**
 * What each call is asked for, by tool: one clause, so the text reads as a
 * plan rather than a list of names. A Strategy keyed by the tool a hint names;
 * a tool with none is listed with its call alone.
 */
const WHY: Readonly<Record<string, string>> = Object.freeze({
  who_calls: 'who calls it, in every service: a caller in another service is a place the change has to reach',
  impact: 'the ways in that reach it, which are what to retest',
  get_source: 'the declaration itself',
  get_flow: 'what it reaches, crossing by crossing',
  describe_for_prompt: 'all of it as Markdown, to hand on',
  get_type: 'its fields and the types nested in it',
  type_usage: 'every way in, crossing, channel and call that takes or returns it',
  who_emits: 'what publishes it',
  who_consumes: 'what handles it',
  check_contract: 'whether both sides of the crossing still agree on the shape',
  cant_follow: 'what the reading could not follow there: a flow that stops early stops at one of these',
  what_changed: 'safe, unsafe or unknown, with the reasons under `because`',
});

const toolOf = (call: string): string => call.slice(0, call.indexOf('('));

/** One numbered step per call, with what it is for. */
const stepsOf = (calls: readonly string[]): string[] =>
  calls.map((call, index) => {
    const why = WHY[toolOf(call)];
    return `${index + 1}. \`${call}\`${why === undefined ? '' : ` — ${why}.`}`;
  });

const text = (description: string, lines: readonly string[]): GetPromptResult => ({
  description,
  messages: [{ role: 'user', content: { type: 'text', text: `${lines.join('\n')}\n` } }],
});

const where = (node: GraphNode): string => {
  const compact = projectDetail(node, 1);
  return [compact.type, compact.service === undefined ? undefined : `in ${compact.service}`, compact.loc === undefined ? undefined : `at \`${compact.loc}\``]
    .filter(Boolean)
    .join(' ');
};

/** A name that answers to several things: list them, each with the call that would take it, and ask which. */
const whichOf = (asked: string, candidates: readonly GraphNode[], call: (id: string) => string): string[] => [
  `\`${asked}\` answers to ${candidates.length === 0 ? 'nothing in the graph' : 'more than one thing'}.`,
  '',
  ...(candidates.length === 0
    ? ['Ask the person which symbol they mean, or `search({query: ...})` for it.']
    : [
        'Ask the person which one they mean, then use this prompt again with its id:',
        '',
        ...candidates.slice(0, MAX_CANDIDATES).map((node) => `- \`${node.id}\` — ${node.label}, ${where(node)}: \`${call(node.id)}\``),
        ...(candidates.length > MAX_CANDIDATES ? [`- … ${candidates.length - MAX_CANDIDATES} more`] : []),
      ]),
];

/** `check_contract` on each crossing, bounded, the rest counted. */
const checksOf = (edges: readonly { from: string; to: string }[]): string[] => {
  const unique = [...new Map(edges.map((edge) => [`${edge.from}|${edge.to}`, edge])).values()];
  const calls = unique.slice(0, MAX_CROSSING_CHECKS).map((edge) => callOf('check_contract', { from: edge.from, to: edge.to }));
  return unique.length > MAX_CROSSING_CHECKS ? [...calls, `… and ${unique.length - MAX_CROSSING_CHECKS} more crossings`] : calls;
};

/**
 * The crossings a node is on: its own edges between services, the requests
 * into the ways in that hand it work, and the requests and publishes of what it
 * calls directly. The edges `check_contract` judges are kept.
 */
const crossingsOf = (db: GraphDb, node: GraphNode): GraphEdge[] => {
  const own = [...db.edgesFrom(node.id, CROSSING_TYPES), ...db.edgesTo(node.id, CROSSING_TYPES)];
  const handledBy = db.edgesTo(node.id, ['handles']).flatMap((edge) => db.edgesTo(edge.from, CROSSING_TYPES));
  const sent = db
    .edgesFrom(node.id, ['calls'])
    .map((edge) => db.node(edge.to))
    .filter((found): found is GraphNode => found !== undefined && found.type !== 'method' && found.type !== 'function')
    .flatMap((found) => db.edgesFrom(found.id, CROSSING_TYPES));
  return [...own, ...handledBy, ...sent].filter((edge) => CHECKED_TYPES.includes(edge.type));
};

const RENAME_TAIL = [
  '',
  'Then say what else must be renamed with it, and where: each caller in another service (a request names a route by its path, a client method by its name), each copy of its shape in another repository, the annotations that spell it (`@CallsService`, `@flowatlas-calls`, `@Emits`), and the ways in to retest. Name ids; do not paste code.',
];

/** `before-rename`: who calls it, what reaches it, every crossing it is on, and what must move with it. */
export const beforeRename = (db: GraphDb, symbol: string): GetPromptResult => {
  const description = `Before renaming ${symbol}`;
  const found = resolveSymbol(db, symbol);
  if (!isResolved(found)) {
    const type = resolveTypeRef(db, symbol);
    if ('id' in type) return renameType(db, type.id);
    const typeCandidates = 'candidates' in type ? type.candidates : [];
    if (found.candidates.length === 0 && typeCandidates.length > 0) {
      return text(description, [
        `# Before renaming \`${symbol}\``,
        '',
        `\`${symbol}\` names more than one type. Ask the person which one they mean, then use this prompt again with its id:`,
        '',
        ...typeCandidates.slice(0, MAX_CANDIDATES).map((id) => `- \`${id}\`: \`${callOf('get_type', { type: id })}\``),
      ]);
    }
    const near = found.candidates.length > 0 ? found.candidates : nearNames(db.search(symbol, { limit: 200 }), symbol, 5);
    return text(description, [`# Before renaming \`${symbol}\``, '', ...whichOf(symbol, near, (id) => callOf('who_calls', { symbol: id }))]);
  }
  const { node } = found;
  const own = hintsFor({ id: node.id, type: node.type });
  const reach = [callOf('who_calls', { symbol: node.id }), callOf('impact', { symbol: node.id })];
  // The node's own hints first, as `next` would give them, then whichever of
  // the two reach questions they leave out; a text to hand on is not a check.
  const calls = [...new Set([...own, ...reach])].filter((call) => toolOf(call) !== 'describe_for_prompt');
  const checks = checksOf(crossingsOf(db, node));
  return text(description, [
    `# Before renaming ${node.label}`,
    '',
    `\`${node.id}\` — ${where(node)}.${found.alsoAnswers === undefined ? '' : ` The same words also answer ${found.alsoAnswers.map((id) => `\`${id}\``).join(', ')}.`}`,
    '',
    'Ask, in this order:',
    '',
    ...stepsOf(calls),
    ...(checks.length === 0
      ? []
      : ['', 'It is on crossings between services. For each, whether both sides still agree:', '', ...checks.map((call) => (call.startsWith('…') ? `- ${call}` : `- \`${call}\``))]),
    ...RENAME_TAIL,
  ]);
};

/** A type: every use of it, and every crossing that carries it. */
const renameType = (db: GraphDb, id: string): GetPromptResult => {
  const uses = usesOfType(db, id);
  const name = db.type(id)?.name ?? id;
  const checks = checksOf([...uses.crossings, ...uses.channels.filter((use) => use.type === 'emits')]);
  return text(`Before renaming ${name}`, [
    `# Before renaming ${name}`,
    '',
    `\`${id}\` — a type${db.type(id)?.declaredIn === undefined ? '' : `, declared in \`${db.type(id)?.declaredIn}\``}.`,
    '',
    'Ask, in this order:',
    '',
    ...stepsOf([...hintsFor({ id, type: 'type' })]),
    ...(checks.length === 0
      ? []
      : ['', 'Crossings between services carry it. For each, whether both sides still agree:', '', ...checks.map((call) => (call.startsWith('…') ? `- ${call}` : `- \`${call}\``))]),
    ...RENAME_TAIL,
  ]);
};

/**
 * `pr-review`: the verdict on the last diff, or the command that makes one.
 *
 * Read-only like everything else here: the diff builds two checkouts and
 * writes to disk, so the prompt says to run it and never runs it.
 */
export const prReview = (dbPath: string, base: string | undefined): GetPromptResult => {
  const description = `Review the branch${base === undefined ? '' : ` against ${base}`}`;
  const asked = base ?? '<base-ref>';
  const state = diffState(dbPath);
  const rerun = (why: string): GetPromptResult =>
    text(description, [
      '# Review this branch',
      '',
      why,
      '',
      `Run \`flowatlas diff ${asked}\` in the project${base === undefined ? ' (the ref the branch will merge into, usually main)' : ''}, then use this prompt again.`,
      `It builds the graph at both revisions in detached checkouts and writes \`diff.json\` beside the database; \`${callOf('what_changed', { verdict: true })}\` reads it.`,
    ]);
  if (state.state === 'missing') return rerun('There is no `diff.json` beside the database: no branch has been compared yet.');
  if (state.state === 'older') {
    return rerun('The last `diff.json` was written before the database was built again, so the head it compared is not the graph being asked.');
  }
  const read = readDiff(dbPath);
  if ('error' in read) return rerun(`The last \`diff.json\` cannot be read: ${read.error}.`);
  if (base !== undefined && read.report.base.ref !== base) {
    return rerun(`The last \`diff.json\` compared against \`${read.report.base.ref ?? 'the working tree'}\`, not \`${base}\`.`);
  }
  return text(description, [
    '# Review this branch',
    '',
    `The last \`flowatlas diff\` compared ${sideLabel(read.report.base)} with ${read.report.head.ref === null ? 'the working tree' : sideLabel(read.report.head)}.`,
    '',
    ...stepsOf([callOf('what_changed', { verdict: true })]),
    '',
    'Then ask the calls its `next` gives, in order: `get_flow` on the first way in under `retest`, `check_contract` on the first break, `get_source` on the method of the first new gap, `who_calls` on a caller under `vanishedTargets`. A cut answer says `nextOffset`: ask again from it.',
    '',
    'Write the review as: the verdict and each reason under `because`, the calls that lost their target and what to do about each, the new gaps a change cannot be seen past, and the ways in to retest, busiest first. Name ids; do not paste code.',
  ]);
};

/** The crossings a walk from a way in reaches, parent to child, breadth first. */
const crossingsOnFlow = (root: FlowNode): Array<{ from: string; to: string }> => {
  const found: Array<{ from: string; to: string }> = [];
  const queue: FlowNode[] = [root];
  for (let at = 0; at < queue.length; at += 1) {
    const row = queue[at]!;
    for (const child of row.children) {
      if (child.edge !== undefined && CHECKED_TYPES.includes(child.edge.type)) found.push({ from: row.node.id, to: child.node.id });
      queue.push(child);
    }
  }
  return found;
};

/** The services the rows of a walk are in, in the order the walk meets them. */
const servicesOnFlow = (root: FlowNode): string[] => {
  const found: string[] = [];
  const queue: FlowNode[] = [root];
  for (let at = 0; at < queue.length; at += 1) {
    const row = queue[at]!;
    if (row.node.service !== undefined) found.push(row.node.service);
    queue.push(...row.children);
  }
  return found;
};

/** `trace-route`: the flow, every crossing on it, what the reading could not follow, and a text to hand on. */
export const traceRoute = (db: GraphDb, route: string): GetPromptResult => {
  const description = `Trace ${route}`;
  const found = resolveEntryRef(db, route);
  if (!isResolved(found)) {
    const near = found.candidates.length > 0 ? found.candidates : nearNames(db.nodesByType('entry'), route, 5);
    return text(description, [`# Trace \`${route}\``, '', ...whichOf(route, near, (id) => callOf('get_flow', { entry: id }))]);
  }
  const { node } = found;
  const flow = buildFlowTree(db, node.id, { maxNodes: FLOW_DEFAULTS.maxNodes });
  const checks = checksOf(crossingsOnFlow(flow.root));
  // Every service the walk is in or reaches the edge of, its own first: where a step it could not follow would be.
  const left = (flow.crossingsLeft ?? []).flatMap((crossing) => (crossing.service === undefined ? [] : [crossing.service]));
  const services = [...new Set([node.repo, ...servicesOnFlow(flow.root), ...left])].filter((name) => name !== '');
  const askWhy = services.map((name) => `\`${callOf('cant_follow', { service: name })}\``).join(', ');
  return text(description, [
    `# Trace ${node.label}`,
    '',
    `\`${node.id}\` — ${where(node)}.${found.alsoAnswers === undefined ? '' : ` The same words also answer ${found.alsoAnswers.map((id) => `\`${id}\``).join(', ')}.`}`,
    '',
    'Ask, in this order:',
    '',
    ...stepsOf([callOf('get_flow', { entry: node.id })]),
    ...(checks.length === 0
      ? ['', 'The walk crosses into no other service.']
      : ['', 'It crosses between services. For each crossing, whether both sides still agree:', '', ...checks.map((call) => (call.startsWith('…') ? `- ${call}` : `- \`${call}\``))]),
    '',
    flow.unresolvedOnPath > 0
      ? `The walk passes ${flow.unresolvedOnPath} place${flow.unresolvedOnPath === 1 ? '' : 's'} the reading could not follow: ask ${askWhy} for why.`
      : `If the flow stops before you expect it to: ${askWhy}.`,
    '',
    `To hand it on: \`${callOf('describe_for_prompt', { id: node.id })}\`.`,
  ]);
};

/** The database, or a prompt that says why there is none: the same sentence the tools give. */
const withDbPrompt = (ctx: ToolContext, description: string, run: (db: GraphDb) => GetPromptResult): GetPromptResult => {
  const opened = ctx.handle.open();
  return 'error' in opened ? text(description, [opened.error]) : run(opened.db);
};

export const registerPrompts = (server: McpServer, ctx: ToolContext): void => {
  server.registerPrompt(
    'before-rename',
    {
      title: 'Before a rename',
      description: 'The calls to make before renaming a symbol, route, channel or type: who calls it, what reaches it, the crossings it is on.',
      argsSchema: { symbol: z.string().describe('an id, a name, or a route said aloud, e.g. "POST /orders"') },
    },
    ({ symbol }) => withDbPrompt(ctx, `Before renaming ${symbol}`, (db) => beforeRename(db, symbol)),
  );
  server.registerPrompt(
    'pr-review',
    {
      title: 'Review a branch',
      description: 'Review the branch from the last flowatlas diff: the verdict, its reasons, and the calls that check them.',
      argsSchema: { base: z.string().optional().describe('the ref it merges into, e.g. main') },
    },
    ({ base }) => prReview(ctx.handle.path, base),
  );
  server.registerPrompt(
    'trace-route',
    {
      title: 'Trace a route',
      description: 'Trace a way in end to end: its flow, each crossing checked, what the reading could not follow.',
      argsSchema: { route: z.string().describe('a way in, e.g. "POST /orders" or an entry id') },
    },
    ({ route }) => withDbPrompt(ctx, `Trace ${route}`, (db) => traceRoute(db, route)),
  );
};
